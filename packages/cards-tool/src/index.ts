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
import {
  CARD_TOOL_NAME, FLOWCHART_KIND, MAX_FLOWCHART_EDGES, MAX_FLOWCHART_LABEL_LENGTH, MAX_FLOWCHART_NODES,
  MAX_KIND_LENGTH, MAX_PAYLOAD_LENGTH, MAX_TABLE_COLUMNS, MAX_TABLE_ROWS,
  MAX_TITLE_LENGTH, TABLE_KIND, summarizeCard, validateCardArgs,
} from '@gk/cards-core'
import type { CardSpec } from '@gk/cards-core'

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
 * a CLI or a text transcript meaningful by echoing the prose summary.
 * @param _args - unused arguments.
 * @param result - the settled result content.
 * @returns the generic text card, or undefined when there is no single text block.
 */
function presentCardResult(
  _args: unknown,
  result: { content: readonly { type: string; text?: string }[] },
): ToolResultView | undefined {
  const block = result.content.length === 1 ? result.content[0] : undefined
  if (block === undefined || block.type !== 'text' || block.text === undefined) return undefined
  return { card: 'generic', content: [{ type: 'text', text: block.text }] }
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
      + 'a script yourself: the conversation renders the card natively. A kind the renderer does not '
      + 'know yet is still accepted and shown as a raw data preview, so a card never disappears; keep '
      + `every payload under ${MAX_PAYLOAD_LENGTH} characters.`,
  })

  ctx.tools.register(defineTool({
    name: CARD_TOOL_NAME,
    description:
      'Show a card in the conversation: a table of numbers, a flowchart of steps, a checklist, a '
      + 'timeline, or any structured summary. Pass `kind` (an identifier such as "table" or '
      + '"flowchart"), an optional `title`, and a `payload` object. '
      + `${TABLE_PAYLOAD_HINT} ${FLOWCHART_PAYLOAD_HINT} Unknown kinds are accepted and rendered as a `
      + 'raw data preview, so prefer inventing an honest kind over forcing a payload into the wrong one.',
    parameters: {
      kind: {
        type: 'string',
        required: true,
        description: `Renderer key, for example "${TABLE_KIND}" or "${FLOWCHART_KIND}". Letters, digits, ".", "_" or "-", at most ${MAX_KIND_LENGTH} characters; an unrecognized kind still renders its payload as a raw preview.`,
      },
      title: {
        type: 'string',
        description: `Optional heading for the card, at most ${MAX_TITLE_LENGTH} characters.`,
      },
      payload: {
        type: 'object',
        additionalProperties: true,
        required: true,
        description: `Kind-owned JSON object. ${TABLE_PAYLOAD_HINT} ${FLOWCHART_PAYLOAD_HINT}`,
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
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.summary }],
      presentationMeta: (_args, value) => ({ card: value.card }),
    },
    async execute(rawArgs, exec) {
      if (exec.signal.aborted) throw new Error('tool call aborted')
      const admitted = validateCardArgs(rawArgs)
      if (!admitted.ok) throw new Error(`invalid card: ${admitted.error}`)
      return { card: asJsonCard(admitted.card), summary: summarizeCard(admitted.card) }
    },
    presentCall: presentCardCall,
    presentResult: presentCardResult,
  }))
}