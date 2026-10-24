/**
 * Model-facing `show_card` tool: the Host half of the generic card channel.
 *
 * A card costs the model a few dozen tokens of *data* -- `kind`, an optional
 * `title`, and a `payload` object -- instead of the hundreds a generated markup
 * page costs, and the conversation draws it as a native row (host theme, dark
 * mode, locale, real interaction) instead of sandboxed markup.
 *
 * The tool stores no geometry and hides no state: it returns the admitted spec,
 * and the browser projection reads the very same arguments back out of the
 * persisted `tool/call` event. That is what makes a replayed session render the
 * identical card with no Host call.
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolCallView, ToolResultView } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import {
  CARD_TOOL_NAME, DRAW_KIND, FIGURE_KIND, FLOWCHART_KIND, MAX_DRAW_ELEMENTS, MAX_FLOWCHART_EDGES, MAX_FLOWCHART_LABEL_LENGTH,
  MAX_FLOWCHART_NODES, MAX_KIND_LENGTH, MAX_PAYLOAD_LENGTH, MAX_TABLE_COLUMNS, MAX_TABLE_ROWS,
  MAX_TITLE_LENGTH, TABLE_KIND, analyzeDraw, buildDrawDisplayList, formatDrawDiagnostics, parseDrawPayload,
  summarizeCard, validateCardArgs,
} from '@aisketch/cards-core'
import type { CardSpec } from '@aisketch/cards-core'
import { buildDrawPreview, routeOf } from './preview.ts'
import type { PreviewAttachment } from './preview.ts'

export const name = 'cards-tool'
export const inject = ['tools', 'systemPrompt']

/** The one payload shape the schema can spell out, so the model reads it before calling. */
const TABLE_PAYLOAD_HINT =
  `A "${TABLE_KIND}" card takes { columns: string[], rows: (string|number|boolean|null)[][] } `
  + `with 1..${MAX_TABLE_COLUMNS} columns and at most ${MAX_TABLE_ROWS} rows.`

/**
 * The diagram payload, spelled out for the same reason: the model supplies
 * structure only, and the renderer -- not the model -- places every box.
 */
const FLOWCHART_PAYLOAD_HINT =
  `A "${FLOWCHART_KIND}" card takes { nodes: { id, label, shape? }[], edges: { from, to, label? }[] } `
  + `with 1..${MAX_FLOWCHART_NODES} nodes and at most ${MAX_FLOWCHART_EDGES} connections. `
  + 'Ids must be unique and every connection must name declared nodes; shape is "terminal", "process" '
  + `or "decision" (default "process"); labels fit in ${MAX_FLOWCHART_LABEL_LENGTH} characters. `
  + 'Never send coordinates or SVG: the client lays the diagram out.'

/**
 * Art direction for a draw card.
 *
 * The medium is hand-drawn ink and wash; the genre is chosen by the request.
 * The previous default called every drawing a field-notebook page, which
 * anchored even scenic requests to labels, tape, empty margins and icon-shaped
 * mountains. The workflow also used to invite a visible retry after every
 * self-check; now inspection is a private draft and the user sees one final.
 */
const DRAW_STYLE_GUIDANCE =
  'Art direction for a draw card:\n'
  + '- If the user asks for a picture, scene, illustration, 插画, 风景 or 绘本, make a finished storybook '
  + 'illustration. Set size 1200x800; layer background (sky/mountains), middle ground (water/trees/buildings) '
  + 'and foreground (shore/reeds/rocks) with overlapping masses; draw organic forms with freehand closed paths, '
  + 'not triangle/rect icons; use 3-6 translucent washes (path fill + fillOpacity .25-.6), 6-10 colors within a '
  + 'few families, hatching/scribble texture, varied line weights and one light direction; keep the ink inside '
  + 'the canvas; add a few narrative details (lit window, dock, boat, reflection) when appropriate. A finished '
  + 'scene normally needs dozens of overlapping path elements, not five icons; fill empty space with drawing '
  + '(layers, texture, foreground), not labels or tape.\n'
  + '- Never add an in-canvas title, labels, tape, highlighter headings or wide empty margins unless the user '
  + 'asked for a field note, diagram or poster. The card title is metadata, not ink.\n'
  + '- A field-note or annotated-diagram request may use paper, tape, a title and 1-3 short labels. A quick '
  + 'doodle may stay at 640x400.\n'
  + 'Delivery: submit at most one private draft (draft:true) to inspect the preview and self-check, fix any '
  + 'structural faults, then publish the finished drawing exactly once with draft omitted. A draft alone is not '
  + 'delivered live; the user sees only the final card. Never publish intermediate versions or call show_card '
  + 'repeatedly for the same drawing.'

/**
 * The compact semantic schemas for the two teaching-figure templates.
 *
 * Deliberately no coordinates: the model supplies a template and physical
 * parameters, and the renderer owns geometry, arrows and tokens.
 */
const FIGURE_PAYLOAD_HINT =
  `A "${FIGURE_KIND}" card takes { template: "incline_force" | "atom_shell", params: {...} }. `
  + 'incline_force params: { angleDeg: 5..85, massKg: 0.1..100, frictionCoeff: 0..2, gravity?: 1..30 '
  + '(default 9.8), showComponents?: boolean, showValues?: boolean }; it draws a block tending to slide down, '
  + 'with friction up-slope, and computes G/N/f plus optional G components. '
  + 'connected_bodies params: { surfaceMassKg: 0.1..100, hangingMassKg: 0.1..100, frictionCoeff: 0..1.5, '
  + 'gravity?: 1..30 (default 9.8), showValues?: boolean }; it draws a table block tied over a fixed pulley to a '
  + 'hanging block, with T/N/G/f anchors by construction; T is qualitative, weights/normal/max friction are shown. '
  + 'orbital_diagram params: { symbol: "H".."Zn" }; draws the electron configuration and orbital boxes for a '
  + 'neutral atom; Z, subshell electrons and arrow placement are derived from the reference table. '
  + 'atom_shell params: { symbol: "H".."Ca", showShellCounts?: boolean }; atomic number Z and shell counts come '
  + 'from the element table, so the model must not supply electron counts. '
  + 'Use figure for teaching/scientific diagrams (受力分析、斜面、原子结构、电子层示意图), never for freehand '
  + 'art; use draw only for artistic illustrations. A figure is a one-shot deterministic card: no draft loop, '
  + 'no coordinates, no SVG, no style tokens in the payload. '
  + 'Examples: { template: "incline_force", params: { angleDeg: 30, massKg: 2, frictionCoeff: 0.5, showComponents: true } }, '
  + '{ template: "connected_bodies", params: { surfaceMassKg: 2, hangingMassKg: 1.5, frictionCoeff: 0.3 } } '
  + '{ template: "orbital_diagram", params: { symbol: "Zn" } } or { template: "atom_shell", params: { symbol: "Na" } }.'

/**
 * The draw payload's syntax, spelled out so a first call is valid. The sample
 * deliberately uses another subject and no labels, tape or title: the previous
 * sample was the same mountain-lake cabin as the screenshot, and models copied
 * its icon composition almost verbatim.
 */
const DRAW_PAYLOAD_HINT =
  `A "${DRAW_KIND}" card takes { size?: { w, h }, paper?: "plain"|"dots"|"grid"|"lined", rough?: boolean, `
  + `elements: [...] } with 1..${MAX_DRAW_ELEMENTS} elements; size defaults to 640x400 (use 1200x800 for a full `
  + 'scene), rough defaults to true. Element shapes: '
  + '{ type: "path", d, pen?, color?, width?, fill?, fillOpacity? } where d is the SVG path grammar '
  + '(M/L/H/V/C/S/Q/T/A/Z, absolute or relative, no exponent numbers), pen is "ball", "fountain", "marker", '
  + '"pencil", "calligraphy", "brush" or "highlighter", fill paints the closed subpaths, and fillOpacity is 0..1 '
  + '(default 1; use .25-.6 for a wash); '
  + '{ type: "shape", shape: "rect"|"ellipse"|"line"|"arrow"|"triangle"|"diamond", x, y, w, h, color?, fill?, '
  + 'fillOpacity?, width?, dash?: "solid"|"dashed"|"dotted", arrowStart? } -- use shapes for genuinely geometric '
  + 'objects, never as a substitute for an organic contour; '
  + '{ type: "text", x, y, text, size?, color?, anchor? ("start"|"middle"|"end"), bold?, hand? } (only when the '
  + 'user asked for words or a field-note/diagram); { type: "tape", x, y, w, h?, color?, angle? } (note paper '
  + 'only); { type: "pixels", x, y, cell?, rows: string[], palette: { "<character>": color } } for pixel art. '
  + 'Colors are names (black, gray, red, orange, yellow, green, teal, cyan, blue, purple, pink, brown, white) or '
  + '#rgb/#rrggbb; omit color for theme ink. Paper defaults to plain; do not add tape, a title or labels to an '
  + 'illustration unless requested. List highlighter strokes before text if you use them. '
  + 'Example (syntax only; never copy its subject): { paper: "plain", rough: true, size: { w: 1200, h: 800 }, '
  + 'elements: ['
  + '{ type: "path", pen: "fountain", color: "#6b4a2f", width: 2.4, fill: "#d9b45b", fillOpacity: .35, '
  + 'd: "M 560 560 C 520 500 540 440 600 430 C 660 440 680 520 640 570 C 610 605 580 590 560 560 Z" }, '
  + '{ type: "path", pen: "pencil", color: "#7d5c3d", width: 1.2, '
  + 'd: "M 570 520 C 600 500 630 510 650 540" }, '
  + '{ type: "path", pen: "brush", color: "#5c7a4b", width: 7, '
  + 'd: "M 610 430 C 615 405 640 390 665 392" } ] }'

/**
 * The pending row: name the kind the model is about to draw, so a long call
 * shows what it is doing before the card exists.
 * @param args - the model's raw arguments.
 * @returns the generic row view.
 */
function presentCardCall(args: unknown): ToolCallView {
  const kind = typeof args === 'object' && args !== null && typeof (args as { kind?: unknown }).kind === 'string'
    ? (args as { kind: string }).kind
    : 'card'
  return { card: 'generic', title: kind, kind: 'read' }
}

/**
 * The settled row for non-browser surfaces.
 *
 * The browser draws the card from the persisted spec; this Host-side view keeps
 * a CLI or a text transcript meaningful by echoing the model-facing text,
 * including the drawing self-check that rides beside a preview image.
 * @param _args - unused arguments.
 * @param result - the settled result content.
 * @returns the generic text card, or undefined when the result carries no text.
 */
function presentCardResult(
  _args: unknown,
  result: { content: readonly { type: string; text?: string }[] },
): ToolResultView | undefined {
  const texts = result.content
    .filter(block => block.type === 'text' && block.text !== undefined)
    .map(block => block.text as string)
  if (texts.length === 0) return undefined
  return { card: 'generic', content: [{ type: 'text', text: texts.join('\n') }] }
}

/** The spec as plain JSON, matching the output schema's open record. */
function asJsonCard(card: CardSpec): Record<string, JsonValue> {
  return card as unknown as Record<string, JsonValue>
}

/**
 * Register the tool and its system-prompt rule.
 * @param ctx - Host context carrying the Tool registry and the system prompt.
 */
export function apply(ctx: Context): void {
  ctx.systemPrompt.section({
    name: `tool:${CARD_TOOL_NAME}`,
    order: ctx.systemPrompt.getSectionOrder('TOOL_WEB_SEARCH'),
    text: 'Use `show_card` whenever the answer is better shown than written: a table of numbers, '
      + 'a flowchart of steps or branches, a checklist, a timeline, a key/value summary. Pass the card '
      + 'as data -- `kind`, an optional `title`, and a `payload` object -- and never write HTML, SVG, or '
      + 'a script yourself: the conversation renders the card natively. When the user asks for a picture '
      + '(画一张 / 画个图 / 手绘 / 素描 / doodle / pixel art) or a drawing would explain better than words, '
      + 'use kind "draw" and list its elements -- pen paths, shapes, text, tape, pixels. For a teaching or '
      + 'scientific diagram (受力分析、斜面、原子结构、电子层、示意图), use kind "figure" with a template and '
      + 'semantic params instead; do not use draw or canvas-design for diagrams. Never emulate a '
      + 'picture with a table, emoji, ASCII art, or colored squares: a freehand picture is a "draw" card, '
      + 'while a teaching/scientific diagram is a "figure" card. '
      + 'A kind the renderer does not know yet is still accepted and shown as a raw data preview, so a '
      + `card never disappears; keep every payload under ${MAX_PAYLOAD_LENGTH} characters. `
      + 'A "draw" card comes back with a picture of what you sent plus a machine self-check. '
      + `${DRAW_STYLE_GUIDANCE} `
      + 'For a non-trivial drawing, call show_card with draft:true at most once, look at its preview and '
      + 'self-check, fix the payload if needed, then publish the finished drawing exactly once with draft '
      + 'omitted. A draft is private and does not appear in the conversation. Never publish intermediate '
      + 'versions, never call show_card repeatedly for the same picture, and do not paste the self-check '
      + 'or an element list into the reply; a short lead-in plus the final card is enough. If the request '
      + 'is a trivial mark you are sure about, skip the draft and publish once.',
  })

  ctx.tools.register(defineTool({
    name: CARD_TOOL_NAME,
    description:
      'Show a card in the conversation: a table of numbers, a flowchart of steps, a hand-drawn sketch, '
      + 'a scientific/teaching figure, a checklist, a timeline, or any structured summary. Pass `kind` '
      + '(an identifier such as "table", "flowchart", "figure" or "draw"), an optional `title`, and a '
      + '`payload` object. For a freehand doodle, illustration or pixel art use kind "draw"; for a teaching '
      + 'or scientific diagram (forces, atomic shells) use kind "figure" with a template and semantic params; '
      + 'never emulate a picture with a table, emoji, ASCII art, or colored squares. '
      + `${TABLE_PAYLOAD_HINT} ${FLOWCHART_PAYLOAD_HINT} ${FIGURE_PAYLOAD_HINT} ${DRAW_PAYLOAD_HINT} Unknown kinds are accepted `
      + 'and rendered as a raw data preview, so prefer inventing an honest kind over forcing a payload '
      + 'into the wrong one. A "draw" card can be returned as a private draft (draft:true): you get a '
      + 'rendered preview plus a machine self-check, but the user does not see that card. When the picture '
      + 'is finished, submit it once with draft omitted. Do not publish intermediate revisions.',
    parameters: {
      kind: {
        type: 'string',
        required: true,
        description: `Renderer key, for example "${TABLE_KIND}", "${FLOWCHART_KIND}", "${FIGURE_KIND}" or "${DRAW_KIND}". Letters, digits, ".", "_" or "-", at most ${MAX_KIND_LENGTH} characters; an unrecognized kind still renders its payload as a raw preview.`,
      },
      title: {
        type: 'string',
        description: `Optional heading for the card, at most ${MAX_TITLE_LENGTH} characters.`,
      },
      payload: {
        type: 'object',
        additionalProperties: true,
        required: true,
        description: `Kind-owned JSON object. ${TABLE_PAYLOAD_HINT} ${FLOWCHART_PAYLOAD_HINT} ${DRAW_PAYLOAD_HINT}`,
      },
      preview: {
        type: 'boolean',
        description: 'Draw cards only: return a rendered preview of the drawing for your own inspection (default true). The preview is private; use draft:true when it is an uncommitted draft. A preview you never look at is worse than none.',
      },
      draft: {
        type: 'boolean',
        description: 'Draw cards only: submit this as a private draft. The preview and self-check come back to you, but no card is shown to the user. Use at most one draft, then submit the finished drawing with draft omitted. Do not publish intermediate revisions.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          card: {
            type: 'object',
            additionalProperties: true,
            required: true,
            description: 'The admitted, versioned CardSpec; the conversation renders this and a replay re-renders it.',
          },
          summary: { type: 'string', required: true },
          selfCheck: {
            type: 'string',
            description: 'Present for "draw" cards: the machine self-check of the drawing (extent, coverage, balance, palette) and any structural faults. It reports geometry, not a prescribed art style.',
          },
          preview: {
            type: 'object',
            additionalProperties: false,
            description: 'Present when the drawing was rasterized and attached as a preview image. The image block beside this text is the picture itself.',
            properties: {
              attachmentId: { type: 'string', required: true },
              mediaType: { type: 'string', required: true },
              bytes: { type: 'integer', required: true },
              width: { type: 'integer', required: true },
              height: { type: 'integer', required: true },
              name: { type: 'string' },
            },
          },
        },
      },
      render: (_args, value) => {
        const text = value.selfCheck === undefined ? value.summary : `${value.summary}\n${value.selfCheck}`
        const blocks: ContentBlock[] = [{ type: 'text', text }]
        // The attachment is committed before the value is returned, so this block
        // references durable bytes and a replay renders the same picture.
        if (value.preview !== undefined) blocks.push({ type: 'image', attachment: value.preview } as unknown as ContentBlock)
        return blocks
      },
      presentationMeta: (_args, value) => ({ card: value.card }),
    },
    async execute(rawArgs, exec) {
      if (exec.signal.aborted) throw new Error('tool call aborted')
      const admitted = validateCardArgs(rawArgs)
      if (!admitted.ok) throw new Error(`invalid card: ${admitted.error}`)

      let selfCheck: string | undefined
      let preview: PreviewAttachment | undefined
      if (admitted.card.kind === DRAW_KIND) {
        const draw = parseDrawPayload(admitted.card.payload)
        if (draw !== null) {
          selfCheck = formatDrawDiagnostics(analyzeDraw(buildDrawDisplayList(draw)))
          if (rawArgs.draft === true) {
            selfCheck += '\n- private draft: not shown to the user; refine, then submit the finished drawing once with draft omitted.'
          }
          if (rawArgs.preview !== false && !exec.signal.aborted) {
            const outcome = await buildDrawPreview(ctx, draw, routeOf(exec), exec.signal)
            if (outcome.ok) preview = outcome.preview.attachment
            else selfCheck = `${selfCheck}\n- preview skipped: ${outcome.skipped}`
          }
        }
      }

      return {
        card: asJsonCard(admitted.card),
        summary: summarizeCard(admitted.card),
        ...selfCheck === undefined ? {} : { selfCheck },
        ...preview === undefined ? {} : { preview },
      }
    },
    presentCall: presentCardCall,
    presentResult: presentCardResult,
  }))
}