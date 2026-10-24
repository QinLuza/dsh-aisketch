/**
 * Model-facing `sketch_function` tool.
 *
 * The point of this tool is the shape of what the model has to produce. Drawing
 * a function graph by writing HTML costs 800-1500 output tokens and is
 * unreviewable; naming an expression costs a handful. Measured across the
 * supported modes, a minified call payload lands between 4 and 45 tokens:
 *
 *   x^2                     4
 *   A*sin(w*x+p), 3 params  20
 *   tangent at a point      9
 *   taylor to order 5       11
 *   3 comparison curves     31
 *   a 2-series bar chart    45
 *
 * The tool does not return geometry: it returns a canonical spec, and the
 * browser card derives the picture from that spec with the same core library.
 * Keeping geometry out of the result is what makes a replayed session render
 * identically without any Host-side artefacts.
 *
 * @module @deepseek-ai/dsh-experimental-sketch-tool
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolCallView, ToolResultView } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import {
  MODES,
  ParseError,
  build,
  freeVariables,
  normalizeMode,
  resolveGeometry,
} from '@aisketch/sketch-core'
import type { Mode, SketchSpec } from '@aisketch/sketch-core'

export const name = 'sketch-tool'
export const inject = ['tools', 'systemPrompt']

/** Upper bound on drawn curves, so one call cannot flood a transcript. */
const MAX_CURVES = 6

/** Upper bound on the Taylor order; past this the numbers stop meaning much. */
const MAX_TAYLOR_ORDER = 12

/** Upper bound on rectangle count in the area mode. */
const MAX_RECTANGLES = 200

/** Parsed tool args; `execute` checks the constraints the schema DSL cannot express. */
interface SketchArgs {
  expr: string
  mode?: string
  params?: Record<string, unknown>
  x_min?: number
  x_max?: number
  curves?: readonly unknown[]
  probe?: number
  a?: number
  b?: number
  n?: number
  order?: number
  center?: number
  dataset?: string
}

/** One parameter tuple: slider bounds and current value. */
type ParamTuple = readonly [number, number, number]

/**
 * Narrow one `params` entry to a validated tuple.
 * @param key - parameter name, for the error message.
 * @param raw - the unvalidated value from the model.
 * @returns the tuple, or a null when the shape is wrong.
 */
function asParamTuple(raw: unknown): ParamTuple | null {
  if (!Array.isArray(raw) || raw.length !== 3) return null
  const [lo, hi, value] = raw as unknown[]
  if (typeof lo !== 'number' || typeof hi !== 'number' || typeof value !== 'number') return null
  if (![lo, hi, value].every(Number.isFinite)) return null
  return [lo, hi, value]
}

/**
 * Reject the arg values the parameter schema cannot express.
 * @param args - the model's arguments.
 * @throws {Error} when a value is out of range or self-contradictory.
 */
function validateArgs(args: SketchArgs): void {
  if (args.expr.trim().length === 0) {
    throw new Error('invalid expr: expected a non-empty expression string')
  }
  if (args.x_min !== undefined && args.x_max !== undefined && !(args.x_max > args.x_min)) {
    throw new Error(`invalid range: x_max (${args.x_max}) must be greater than x_min (${args.x_min})`)
  }
  if (args.order !== undefined && (!Number.isInteger(args.order) || args.order < 1 || args.order > MAX_TAYLOR_ORDER)) {
    throw new Error(`invalid order: expected an integer in [1, ${MAX_TAYLOR_ORDER}], got ${args.order}`)
  }
  if (args.n !== undefined && (!Number.isInteger(args.n) || args.n < 1 || args.n > MAX_RECTANGLES)) {
    throw new Error(`invalid n: expected an integer in [1, ${MAX_RECTANGLES}], got ${args.n}`)
  }
  if (args.curves !== undefined && args.curves.length > MAX_CURVES - 1) {
    throw new Error(`invalid curves: at most ${MAX_CURVES - 1} additional curves (got ${args.curves.length})`)
  }
  for (const [key, raw] of Object.entries(args.params ?? {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`invalid parameter name "${key}": expected an identifier`)
    }
    const tuple = asParamTuple(raw)
    if (tuple === null) {
      throw new Error(`invalid parameter "${key}": expected three finite numbers [min, max, value]`)
    }
    const [lo, hi, value] = tuple
    if (!(hi > lo)) {
      throw new Error(`invalid parameter "${key}": max (${hi}) must exceed min (${lo})`)
    }
    if (value < lo || value > hi) {
      throw new Error(`invalid parameter "${key}": value ${value} lies outside [${lo}, ${hi}]`)
    }
  }
}

/**
 * Turn the model's arguments into the canonical spec the card renders.
 *
 * Parameters the expression does not actually use are dropped rather than
 * rejected: a model that guesses `A` for `sin(x)` should still get a picture.
 * @param args - validated arguments.
 * @returns the canonical spec, free of undefined members.
 */
function toSpec(args: SketchArgs): SketchSpec {
  const mode = normalizeMode(args.mode)
  let vars: readonly string[]
  try {
    vars = freeVariables(build(args.expr).ast)
  } catch {
    vars = []
  }
  const used = new Set(vars)

  const params: Record<string, ParamTuple> = {}
  for (const [key, raw] of Object.entries(args.params ?? {})) {
    if (!used.has(key)) continue
    const tuple = asParamTuple(raw)
    if (tuple !== null) params[key] = tuple
  }

  const curves = (args.curves ?? []).filter((c): c is string => typeof c === 'string' && c.length > 0)

  return {
    expr: args.expr.trim(),
    ...Object.keys(params).length > 0 ? { params } : {},
    ...mode !== 'plain' ? { mode } : {},
    ...args.x_min !== undefined && args.x_max !== undefined
      ? { range: { x: [args.x_min, args.x_max] as const } }
      : {},
    ...curves.length > 0 ? { compare: curves } : {},
    ...args.dataset !== undefined ? { data: args.dataset } : {},
    ...args.center !== undefined ? { center: args.center } : {},
  }
}

/** Format a number for prose without exponent noise on ordinary values. */
function num(v: number, digits = 4): string {
  if (!Number.isFinite(v)) return String(v)
  if (v !== 0 && Math.abs(v) < 1e-3) return v.toExponential(2)
  return Number(v.toFixed(digits)).toString()
}

/**
 * Describe the plot in text, which is what the model actually reads.
 *
 * The picture is the deliverable for the human; this prose is the deliverable
 * for the model, so it states the facts a follow-up turn would need — the
 * window, the parameter values, and any computed quantity worth quoting.
 * @param spec - the canonical spec.
 * @param mode - the resolved mode.
 * @param geometry - what the card will draw.
 * @returns a short, factual description.
 */
function summarize(spec: SketchSpec, mode: Mode, geometry: ReturnType<typeof resolveGeometry>): string {
  const lines: string[] = []
  const window = `x ∈ [${num(geometry.xRange[0])}, ${num(geometry.xRange[1])}]`
  const yWindow = `y ∈ [${num(geometry.yRange.yMin)}, ${num(geometry.yRange.yMax)}]`

  if (mode === 'data') {
    lines.push(`Drew a data chart for "${spec.data ?? spec.expr}" (${window}).`)
    return lines.join('\n')
  }

  const paramText = Object.entries(spec.params ?? {})
    .map(([k, v]) => `${k}=${num(v[2])}`)
    .join(', ')

  lines.push(`Drew ${spec.expr}${paramText.length > 0 ? ` with ${paramText}` : ''} (${window}, ${yWindow}).`)

  if (geometry.curves.length > 1) {
    const labels = geometry.curves
      .map((c) => c.label ?? c.expr)
      .join(', ')
    lines.push(`Curves: ${labels}.`)
  }

  const tangent = geometry.tangent
  if (tangent !== undefined) {
    lines.push(`At x=${num(tangent.x)}: f(x)=${num(tangent.y)}, slope f'(x)=${num(tangent.slope)}.`)
  }

  const riemann = geometry.riemann
  if (riemann !== undefined) {
    const sum = num(riemann.sum)
    const exact = num(riemann.exact)
    const error = Math.abs(riemann.sum - riemann.exact)
    lines.push(
      `Riemann sum over [${num(riemann.a)}, ${num(riemann.b)}] with n=${riemann.n}: ${sum}; `
      + `exact integral ${exact}; absolute error ${num(error)}.`,
    )
  }

  const taylor = geometry.taylor
  if (taylor !== undefined) {
    const terms = taylor.coefficients.map((c, k) => {
      if (k === 0) return num(c)
      const power = k === 1 ? '(x-a)' : `(x-a)^${k}`
      return `${num(c)}${power}`
    })
    lines.push(`Taylor at a=${num(taylor.center)}, degree ${taylor.order}: ${terms.join(' + ')}.`)
  }

  return lines.join('\n')
}

/** The pending card for a call: echo the expression the model asked for. */
function presentSketchCall(args: SketchArgs): ToolCallView {
  return {
    card: 'generic',
    title: args.expr,
    kind: 'read',
    ...args.mode !== undefined && args.mode !== 'plain' ? { content: [{ type: 'text' as const, text: args.mode }] } : {},
  }
}

/**
 * The completed card falls back to generic text.
 *
 * The browser draws the plot through its own keyed `tool.call.toolview` entry,
 * reading the persisted spec out of the result; this Host-side view exists so
 * non-browser surfaces still show something meaningful.
 * @param args - the model's arguments.
 * @param result - the settled result.
 * @returns a generic card carrying the rendered prose.
 */
function presentSketchResult(_args: unknown, result: { content: readonly { type: string; text?: string }[] }): ToolResultView | undefined {
  const block = result.content.length === 1 ? result.content[0] : undefined
  if (block === undefined || block.type !== 'text' || block.text === undefined) return undefined
  return { card: 'generic', content: [{ type: 'text', text: block.text }] }
}

/**
 * The canonical spec as plain JSON.
 *
 * The output schema declares `spec` with `additionalProperties: true`, which
 * the registry types as a `JsonValue` record. A `SketchSpec` is already pure
 * JSON data with no functions or class instances, so one cast bridges the
 * nominal gap with no runtime cost.
 * @param spec - the resolved spec.
 * @returns the spec widened to the schema's JSON record type.
 */
function asJsonSpec(spec: SketchSpec): Record<string, JsonValue> {
  return spec as unknown as Record<string, JsonValue>
}

export function apply(ctx: Context): void {
  ctx.systemPrompt.section({
    name: 'tool:sketch_function',
    order: ctx.systemPrompt.getSectionOrder('TOOL_WEB_SEARCH'),
    text: 'Use `sketch_function` whenever the answer involves a function graph, a curve comparison, a '
      + 'derivative, an area, or a data chart. Pass the expression; do not write HTML, SVG, or a plotting '
      + 'script yourself — the tool renders a live card in the conversation.',
  })

  ctx.tools.register(defineTool({
    name: 'sketch_function',
    description:
      'Draw a function graph, calculus demo, or data chart as a live card in the conversation. '
      + 'Give an expression in `expr` using x as the variable (sin, cos, tan, exp, log, sqrt, abs, and the '
      + 'constants pi/e are available; implicit multiplication like `2x` or `3sin(x)` works). '
      + 'Any other identifier becomes a tunable parameter — declare its slider bounds in `params` so the '
      + 'user can animate it. Modes: `plain` (default curve), `compare` (several curves from `curves`), '
      + '`tangent` (a tangent line at `probe`), `riemann` (an area sum over `a`..`b` with `n` rectangles), '
      + '`taylor` (an expansion about `center` to degree `order`), and `data` (a named sample chart via '
      + '`dataset`). Returns a description of what was drawn, including any computed quantity.',
    parameters: {
      expr: {
        type: 'string',
        required: true,
        description: 'The function expression in x. Examples: "x^2", "A*sin(w*x+p)", "sin(x)/x", "exp(-x^2)".',
      },
      mode: {
        type: 'string',
        enum: [...MODES],
        description: 'What to draw. Defaults to "plain".',
      },
      params: {
        type: 'object',
        additionalProperties: true,
        description:
          'Tunable parameters named in `expr`, each as [min, max, value]. Example: '
          + '{"A": [0.2, 2, 1], "w": [0.5, 4, 1]}. The user can sweep the first one as an animation.',
      },
      x_min: { type: 'number', description: 'Left edge of the x-window. Chosen automatically when omitted.' },
      x_max: { type: 'number', description: 'Right edge of the x-window. Chosen automatically when omitted.' },
      curves: {
        type: 'array',
        description:
          'Extra curves for the compare mode, each "label, expr" or just "expr". '
          + 'Example: ["抛物线, x^2", "直线, 2x"]. `expr` is drawn alongside them.',
      },
      probe: { type: 'number', description: 'Tangent mode: where to draw the tangent line. Defaults to the window centre.' },
      a: { type: 'number', description: 'Area mode: lower bound of the interval. Defaults to 0.' },
      b: { type: 'number', description: 'Area mode: upper bound of the interval. Defaults to pi.' },
      n: { type: 'number', description: `Area mode: rectangle count, 1..${MAX_RECTANGLES}. Defaults to 15.` },
      order: { type: 'number', description: `Series mode: expansion degree, 1..${MAX_TAYLOR_ORDER}. Defaults to 5.` },
      center: { type: 'number', description: 'Series mode: expansion point a. Defaults to 0.' },
      dataset: {
        type: 'string',
        enum: ['line', 'bar', 'scatter', 'pie'],
        description: 'Data mode: which sample chart to draw. Defaults to "line".',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          spec: {
            type: 'object',
            additionalProperties: true,
            required: true,
            description: 'The canonical plot specification, replayed by the card.',
          },
          summary: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.summary }],
      presentationMeta: (_args, value) => ({ spec: value.spec }),
    },
    async execute(rawArgs, exec) {
      if (exec.signal.aborted) throw new Error('tool call aborted')
      const args = rawArgs as unknown as SketchArgs
      validateArgs(args)

      const spec = toSpec(args)
      // Parse before rendering so a typo surfaces as a tool error the model can
      // correct, rather than as a silently blank card.
      try {
        build(spec.expr)
        for (const line of spec.compare ?? []) {
          build(line.replace(/^[^,]*,\s*/, '').replace(/^y\s*=\s*/i, ''))
        }
      } catch (error) {
        const detail = error instanceof ParseError
          ? `${error.message} (at offset ${error.index})`
          : error instanceof Error ? error.message : String(error)
        throw new Error(`cannot parse expression: ${detail}`)
      }

      const mode = normalizeMode(spec.mode)
      const geometry = resolveGeometry(spec, {
        ...args.order !== undefined ? { taylorOrder: args.order } : {},
        ...args.center !== undefined ? { center: args.center } : {},
        ...args.probe !== undefined ? { probe: args.probe } : {},
        ...args.a !== undefined ? { a: args.a } : {},
        ...args.b !== undefined ? { b: args.b } : {},
        ...args.n !== undefined ? { n: args.n } : {},
      })

      if (mode !== 'data' && geometry.curves.every((c) => c.points.length === 0)) {
        throw new Error(`cannot parse expression: "${spec.expr}"`)
      }

      return { spec: asJsonSpec(spec), summary: summarize(spec, mode, geometry) }
    },
    presentCall: presentSketchCall,
    presentResult: presentSketchResult,
  }))
}
