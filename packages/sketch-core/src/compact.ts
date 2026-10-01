/**
 * Sketch spec compaction.
 *
 * Why this exists: the user decided plot specs should live in conversation
 * history so a sketch can be re-edited later ("change the last plot to
 * sin(2x)"). Storing the full spec every turn would grow the session linearly,
 * and anything inside the prompt prefix also inflates the KV cache. This module
 * defines three representation levels and a policy that demotes old specs.
 *
 * Levels, cheapest last:
 *   L1 full     { expr, params:{A:[min,max,value]}, mode?, range?, compare? }   ~20 tok
 *   L2 summary  { expr, mode? }                                                ~6 tok
 *   L3 reference{ ref, kind }                                                  ~5 tok
 *
 * Demotion is lossy on purpose, but never destructive of the thing the user
 * cares about: `expr` survives to L2, and the id survives to L3 so the caller
 * can resolve the original from its own store.
 */

/** Representation levels, ordered from richest to cheapest. */
export const LEVEL = {
  FULL: 'L1',
  SUMMARY: 'L2',
  REFERENCE: 'L3',
} as const

/** One representation level name. */
export type LevelName = (typeof LEVEL)[keyof typeof LEVEL]

/** How many recent turns keep their full spec. */
export const DEFAULT_KEEP_TURNS = 3

/** Only the most recent sketch in a turn keeps its full spec. */
export const FULL_PER_TURN = 1

/**
 * After this many turns a sketch is dropped entirely rather than referenced.
 *
 * A reference is cheap but not free (~5 tokens). Keeping one for every sketch
 * ever drawn makes references dominate the budget in a long session — measured
 * at 68% of the compacted cost over 20 turns. Past this horizon nobody reopens
 * an old sketch, so the correct policy is to forget it outright.
 */
export const DEFAULT_FORGET_AFTER = 6

/** An x-range override carried by a spec. */
export interface SpecRange {
  /** Inclusive lower and upper x bounds. */
  readonly x: readonly [number, number]
}

/**
 * A named parameter: its slider bounds and current value.
 *
 * The tuple shape is deliberate — three numbers in a fixed order cost far fewer
 * tokens than an object with keys.
 */
export type ParamSpec = readonly [min: number, max: number, value: number]

/** The complete plot request handed to the rendering engine. */
export interface SketchSpec {
  /** The main expression, e.g. `A*sin(w*x+p)`. */
  readonly expr: string
  /** Named parameters, keyed by the identifier used in `expr`. */
  readonly params?: Readonly<Record<string, ParamSpec>>
  /** Analysis mode. Absent means a plain curve. */
  readonly mode?: string
  /** Explicit x-window, overriding the engine's automatic choice. */
  readonly range?: SpecRange
  /** Extra curve expressions, for the comparison mode. */
  readonly compare?: readonly string[]
  /** A dataset name, for the data-chart mode. */
  readonly data?: string
  /** Alias for `data`, accepted because charts read naturally as "series". */
  readonly series?: string
  /** Expansion point for the taylor mode. */
  readonly center?: number
}

/** The L2 form: enough to recognise a sketch, not enough to redraw it. */
export interface SummarySpec {
  /** The expression, preserved because it is what a user names a sketch by. */
  readonly expr: string
  /** Mode, omitted when plain to save the key. */
  readonly mode?: string
}

/**
 * The L3 form: a positional tuple, not an object.
 *
 * An object's two keys would cost more characters than the one-key summary it
 * replaces, which would defeat the entire policy.
 */
export type ReferenceSpec = readonly [ref: string, kind: string]

/** Any of the three representation levels. */
export type AnySpec = SketchSpec | SummarySpec | ReferenceSpec

/** One turn's worth of sketches, as the compaction policy sees them. */
export interface Turn {
  /** Sketches drawn in this turn, in draw order. */
  readonly specs: readonly AnySpec[]
}

/** Options controlling how aggressively the policy demotes specs. */
export interface CompactOptions {
  /** How many trailing turns keep FULL specs. */
  readonly keepTurns?: number
  /** How many trailing specs per turn keep FULL. */
  readonly fullPerTurn?: number
  /** How far back references are worth keeping at all. */
  readonly forgetAfterTurns?: number
}

/**
 * Compact a full spec into the L2 summary form.
 * Drops parameters and ranges; keeps the expression and the analysis mode.
 * @param spec - a full (L1) spec.
 * @returns the L2 form.
 */
export function toSummary(spec: SketchSpec): SummarySpec {
  const out: { expr: string; mode?: string } = { expr: spec.expr }
  if (spec.mode !== undefined && spec.mode !== 'plain') out.mode = spec.mode
  return out
}

/**
 * Reduce a spec to a bare reference placeholder.
 *
 * A reference must be strictly cheaper than a summary, so it carries NO copy of
 * the expression.
 *
 * @param spec - any-level spec, used only to pick a short type label.
 * @param ref - stable identifier the caller can resolve later.
 * @returns the L3 form.
 */
export function toReference(spec: SketchSpec | SummarySpec, ref: string): ReferenceSpec {
  return [ref, kindOf(spec)]
}

/** @returns true when the value is an L3 reference tuple. */
export function isReference(spec: AnySpec): spec is ReferenceSpec {
  return Array.isArray(spec) && spec.length === 2 && typeof spec[0] === 'string'
}

/**
 * Classify a spec into a one-word kind for reference labels.
 * @param spec - any-level spec.
 * @returns a short label such as 'curve', 'tangent' or 'data'.
 */
export function kindOf(spec: SketchSpec | SummarySpec): string {
  const wide = spec as SketchSpec
  if (wide.data !== undefined || wide.series !== undefined) return 'data'
  switch (spec.mode) {
    case 'tangent':
    case 'derivative':
      return 'tangent'
    case 'riemann':
      return 'area'
    case 'taylor':
      return 'series'
    default:
      return 'curve'
  }
}

/**
 * One-line description of a spec, used for L3 hints and card titles.
 * @param spec - any-level spec.
 * @returns a short human-readable label.
 */
export function describe(spec: SketchSpec | SummarySpec): string {
  const base = spec.expr ?? 'unknown'
  if (spec.mode !== undefined && spec.mode !== 'plain') return `${base} (${spec.mode})`
  return base
}

/**
 * Apply the demotion policy to a chronological list of turns.
 *
 * Three bands, from newest to oldest:
 *   within `keepTurns`        : the last `fullPerTurn` sketches stay FULL
 *   within `forgetAfterTurns` : older sketches become SUMMARY, or REFERENCE
 *   beyond `forgetAfterTurns` : sketches are dropped entirely
 *
 * @param turns - newest-last array of `{ specs }`.
 * @param options - band widths; see the defaults.
 * @returns a new array; input is not mutated.
 */
export function compact(turns: readonly Turn[], options: CompactOptions = {}): Turn[] {
  const keepTurns = options.keepTurns ?? DEFAULT_KEEP_TURNS
  const fullPerTurn = options.fullPerTurn ?? FULL_PER_TURN
  const forgetAfter = options.forgetAfterTurns ?? DEFAULT_FORGET_AFTER
  const fullCutoff = turns.length - keepTurns
  const forgetCutoff = turns.length - forgetAfter

  return turns.map((turn, turnIndex) => {
    const inFullWindow = turnIndex >= fullCutoff
    const inMemoryWindow = turnIndex >= forgetCutoff
    // Beyond the horizon the whole turn's sketches are forgotten.
    if (!inMemoryWindow) return { specs: [] }

    const specs = turn.specs ?? []
    const nextSpecs: AnySpec[] = specs.map((spec, specIndex) => {
      const isRecent = inFullWindow && specIndex >= specs.length - fullPerTurn
      if (isRecent) return spec
      if (isReference(spec)) return spec
      // Inside the memory window an older sketch keeps enough to be recognised.
      if (inFullWindow) return toSummary(spec as SketchSpec)
      return toReference(spec as SketchSpec | SummarySpec, `${turnIndex}-${specIndex}`)
    })
    return { specs: nextSpecs }
  })
}

/** @returns true when the value is an L2 summary (expr only, no params). */
export function isSummary(spec: AnySpec): spec is SummarySpec {
  return (
    spec !== null &&
    typeof spec === 'object' &&
    !Array.isArray(spec) &&
    typeof (spec as SummarySpec).expr === 'string' &&
    (spec as SketchSpec).params === undefined
  )
}

/**
 * Estimated token cost of a spec, using the common ~4 characters per token rule.
 * Good enough for policy decisions; not a substitute for a real tokenizer.
 * @param spec - any-level spec.
 * @returns approximate token count.
 */
export function estimateTokens(spec: unknown): number {
  return Math.ceil(JSON.stringify(spec).length / 4)
}

/** The outcome of applying one natural-language edit. */
export interface EditResult {
  /** The edited spec. */
  readonly spec: SketchSpec
  /** Which fields were modified, e.g. `['param:A']`. */
  readonly changed: readonly string[]
}

/**
 * Resolve a follow-up edit against a previous spec.
 *
 * Handles the natural phrasings a user reaches for:
 *   "把上图改成 sin(2x)"        -> replace the expression
 *   "把 A 改成 2"               -> set one parameter's value
 *   "把范围改成 [-5,5]"         -> replace the x-range
 *
 * Order matters: the specific rules run before the catch-all expression rule,
 * otherwise "把 A 改成 1.5" would be read as "replace the expression with 1.5".
 *
 * @param previous - the spec to edit (L1 or L2).
 * @param instruction - the user's natural-language instruction.
 * @returns the edited spec plus a list of what changed.
 */
export function applyEdit(previous: SketchSpec | SummarySpec, instruction: string): EditResult {
  const changed: string[] = []
  const prev = previous as SketchSpec
  const next: {
    expr: string
    params?: Record<string, ParamSpec>
    mode?: string
    range?: SpecRange
    compare?: readonly string[]
    data?: string
    series?: string
    center?: number
  } = { ...prev }
  if (prev.params !== undefined) next.params = { ...prev.params }

  // Case 1: an explicit x-range, e.g. "把范围改成 [-5,5]".
  const rangeMatch = instruction.match(/\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]/)
  if (rangeMatch !== null) {
    // Reject a bare "[-5,5]" that is actually the new expression body.
    if (!/改成|换成|变为|改为|变成/.test(instruction) || /范围|窗口|区间|视窗/.test(instruction)) {
      next.range = { x: [Number(rangeMatch[1]), Number(rangeMatch[2])] }
      changed.push('range')
      return { spec: next as SketchSpec, changed }
    }
  }

  // Case 2: assign a named parameter, e.g. "A 改成 2" or "A=2".
  const paramMatch = instruction.match(/\b([A-Za-z][A-Za-z0-9]?)\s*(?:改成|设为|设置为|=)\s*(-?[\d.]+)/)
  if (paramMatch !== null) {
    const name = paramMatch[1] as string
    const value = paramMatch[2] as string
    // Skip when the captured "name" is really the start of an expression.
    const prefix = instruction.slice(0, paramMatch.index ?? 0)
    if (!/(?:改成|换成|变为|改为|变成)\s*$/.test(prefix)) {
      const num = Number(value)
      const existing = next.params?.[name]
      if (existing !== undefined) {
        next.params = { ...next.params, [name]: [existing[0], existing[1], num] }
      } else {
        const span = Math.abs(num) * 2 || 2
        next.params = { ...(next.params ?? {}), [name]: [-span, span, num] }
      }
      changed.push(`param:${name}`)
      return { spec: next as SketchSpec, changed }
    }
  }

  // Case 3: an explicit new expression after 改成 / 换成 / 变为.
  const exprMatch = instruction.match(/(?:改成|换成|变为|改为|变成)\s*(.+?)\s*$/)
  if (exprMatch !== null) {
    const candidate = (exprMatch[1] as string).replace(/[。，,]$/, '').trim()
    if (looksLikeExpression(candidate)) {
      next.expr = candidate
      delete next.params
      changed.push('expr')
      return { spec: next as SketchSpec, changed }
    }
  }

  return { spec: next as SketchSpec, changed }
}

/**
 * Heuristic check for whether a string is plausibly a math expression.
 * Guards against swallowing ordinary prose that happens to follow 改成.
 * @param text - candidate string.
 * @returns true when it contains math-y characters and no obvious prose markers.
 */
function looksLikeExpression(text: string): boolean {
  if (text.length === 0 || text.length > 120) return false
  // A stray Chinese sentence particle means this was prose, not a formula.
  if (/[的把了是我你他她它这那]/.test(text)) return false
  return /[xX0-9()+\-*/^]/.test(text)
}
