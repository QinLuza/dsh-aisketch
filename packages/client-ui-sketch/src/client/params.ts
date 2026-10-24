/**
 * The local parameter state behind the card's sliders, and the y-window rule
 * that keeps them from moving the axes.
 *
 * Interaction state lives here and in the component, never in the spec: the
 * persisted `params` tuple keeps the values the call declared, so a replay or a
 * reload rests every slider back where the AI put it.
 *
 * The window is frozen over the **corners of the parameter box** rather than
 * the current values. A window that follows the curve is the defect already
 * recorded once for the sweep animation -- the axes quietly re-fit every frame,
 * so the waveform looks pinned to a band while everything moves. Corners are
 * what any combination of slider positions can reach.
 */
import { build, resolveGeometry, splitCurveLine } from '@aisketch/sketch-core'
import type { CompiledFn, ParamSpec, Range, SketchSpec } from '@aisketch/sketch-core'

/** The current value of each declared parameter. */
export type ParamValues = Readonly<Record<string, number>>

/** Above this many parameters the corner probe would exceed its cost bound. */
const CORNER_LIMIT = 5

/**
 * Where every slider rests before the user touches it.
 * @param spec - the persisted spec.
 * @returns each declared parameter's declared value.
 */
export function initialValues(spec: SketchSpec): ParamValues {
  const values: Record<string, number> = {}
  for (const [name, tuple] of Object.entries(spec.params ?? {})) values[name] = tuple[2]
  return values
}

/**
 * Rebuild the spec with new current values, keeping bounds and every other field.
 * @param spec - the persisted spec.
 * @param values - the local parameter state; undeclared keys are ignored.
 * @returns an equivalent spec when nothing moved.
 */
export function withValues(spec: SketchSpec, values: ParamValues): SketchSpec {
  const declared = spec.params
  if (declared === undefined) return spec
  const params: Record<string, ParamSpec> = {}
  let moved = false
  for (const [name, tuple] of Object.entries(declared)) {
    const value = values[name]
    if (value === undefined || value === tuple[2]) {
      params[name] = tuple
      continue
    }
    params[name] = [tuple[0], tuple[1], value]
    moved = true
  }
  return moved ? { ...spec, params } : spec
}

/**
 * One slider's increment.
 * @param tuple - the declared `[min, max, value]`.
 * @returns a positive finite step, even for a degenerate or malformed box.
 */
export function stepOf(tuple: ParamSpec): number {
  const span = tuple[1] - tuple[0]
  return Number.isFinite(span) && span > 0 ? span / 200 : 0.01
}

/**
 * One compiled evaluator per plotted expression, keyed by the bare expression.
 *
 * A comparison entry arrives as `label, expr`, so the label comes off before
 * compiling: building the raw line once threw
 * `ParseError: Unexpected character "高"` on a Chinese label, and because the
 * compile ran during render it took the whole card slot down with it
 * (2026-10-18). `splitCurveLine` is the same splitter the engine uses, so the
 * card cannot disagree with the geometry it draws; an expression that still
 * refuses to compile simply has no tracer rather than no card.
 * @param spec - the persisted spec.
 * @returns the evaluator map the hover readout draws from.
 */
export function compileCurves(spec: SketchSpec): ReadonlyMap<string, CompiledFn> {
  const map = new Map<string, CompiledFn>()
  const expressions = [spec.expr, ...(spec.compare ?? []).map(line => splitCurveLine(line).expr)]
  for (const expr of expressions) {
    if (map.has(expr)) continue
    try {
      map.set(expr, build(expr).eval)
    } catch {
      // A refused expression has no curve to trace; the picture still draws.
    }
  }
  return map
}

/** The y-window the engine would choose for one spec, as a probe candidate. */
function probe(spec: SketchSpec): Range {
  return resolveGeometry(spec).yRange
}

/**
 * The y-window that holds every slider position the card can reach.
 * @param spec - the persisted spec; its current values are irrelevant here.
 * @returns the union of the sampled y-ranges over the parameter box.
 */
export function freezeWindow(spec: SketchSpec): Range {
  const declared = Object.entries(spec.params ?? {})
  if (declared.length === 0) return probe(spec)
  const names = declared.map(([name]) => name)
  const spans = declared.map(([, tuple]) => tuple)
  const candidates: Range[] = []
  if (names.length <= CORNER_LIMIT) {
    // Every corner of the box: each parameter at either bound.
    for (let mask = 0; mask < 2 ** names.length; mask += 1) {
      const values: ParamValues = Object.fromEntries(names.map((name, index) => {
        const tuple = spans[index] as ParamSpec
        return [name, mask & (1 << index) ? tuple[1] : tuple[0]]
      }))
      candidates.push(probe(withValues(spec, values)))
    }
  } else {
    // Cost bound wins over exactness: each parameter alone at lo, mid, and hi.
    for (const [name, tuple] of declared) {
      for (const value of [tuple[0], (tuple[0] + tuple[1]) / 2, tuple[1]]) {
        candidates.push(probe(withValues(spec, { [name]: value })))
      }
    }
  }
  return {
    yMin: Math.min(...candidates.map((range) => range.yMin)),
    yMax: Math.max(...candidates.map((range) => range.yMax)),
  }
}
