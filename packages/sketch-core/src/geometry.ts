/**
 * Sketch spec resolution: expression + mode -> concrete geometry.
 *
 * The prototype kept these decisions inside its UI file, which made them
 * untestable and impossible to reuse from the Host tool. They live here so the
 * Host can compute exactly what the card draws, and so a replay from the
 * persisted spec reproduces the same picture.
 */

import type { CompiledExpression, Scope } from './parser.ts'
import { build, integrate, nthDerivativeAt, taylorCoefficients, taylorEvaluator } from './parser.ts'
import type { SketchSpec } from './compact.ts'

/** Analysis modes the engine understands. `plain` is the default curve. */
export const MODES = ['plain', 'compare', 'tangent', 'riemann', 'taylor', 'data'] as const

/** One analysis mode name. */
export type Mode = (typeof MODES)[number]

/** @returns true when the string names a supported mode. */
export function isMode(value: string): value is Mode {
  return (MODES as readonly string[]).includes(value)
}

/** Normalise an incoming mode string, defaulting to `plain`. */
export function normalizeMode(value: string | undefined): Mode {
  return value !== undefined && isMode(value) ? value : 'plain'
}

/**
 * Choose the x-window for an expression.
 *
 * The heuristics here are the prototype's, kept deliberately simple: a window
 * that shows the interesting part of the common shapes. A caller that knows
 * better can always pass an explicit `range`.
 *
 * @param spec - the sketch spec, whose `range` wins when present.
 * @param mode - the resolved mode, which biases the window.
 * @param order - taylor order, which sets the taylor window.
 * @param compiled - the compiled expression, used to probe magnitude.
 * @returns inclusive `[xMin, xMax]`.
 */
export function resolveXRange(
  spec: SketchSpec,
  mode: Mode,
  order = 5,
  compiled?: CompiledExpression,
): readonly [number, number] {
  if (spec.range !== undefined) return spec.range.x
  const e = spec.expr

  // Taylor is about local agreement, so a wide window makes every polynomial
  // look wrong. Use a tight window scaled to the expansion order.
  if (mode === 'taylor') {
    const span = Math.min(2 * Math.PI, 2.5 + Math.round(order) * 0.45)
    return [-span, span]
  }
  if (mode === 'compare') return [-4, 4]
  // Poles and logs read badly across a wide window.
  if (/\b1\s*\//.test(e)) return [-4, 4]
  if (/\blog\s*\(/.test(e) || /\bln\s*\(/.test(e)) return [0.02, 6]
  // Trig and oscillatory expressions want a few full periods.
  if (/\b(sin|cos|tan)\s*\(/.test(e)) return [-2 * Math.PI, 2 * Math.PI]
  // Gaussian-style decay is only interesting near the origin.
  if (/exp\s*\(\s*-/.test(e)) return [-3, 3]
  // Polynomials: scale the window with the observed growth.
  if (/\^/.test(e) && compiled !== undefined) {
    let peak = 0
    for (const [, y] of compiled.sample(-6, 6, 241)) {
      if (y !== null && Math.abs(y) > peak) peak = Math.abs(y)
    }
    if (peak > 0) {
      // Aim for a visible y-span of roughly ±12 so curvature stays legible.
      const span = Math.min(8, Math.max(2, 12 / Math.max(1, Math.cbrt(peak))))
      return [-span, span]
    }
  }
  if (mode === 'riemann') return [-1, 4]
  return [-6, 6]
}

/** An inclusive numeric interval, used for both axes. */
export interface Range {
  /** Lower bound. */
  readonly yMin: number
  /** Upper bound. */
  readonly yMax: number
}

/** A single point with a value, or null where the function is undefined. */
export interface Point {
  /** Horizontal coordinate. */
  readonly x: number
  /** Vertical coordinate, or null where the function has no finite value. */
  readonly y: number | null
}

/**
 * Fit a y-range to a set of sampled points.
 *
 * Uses percentile clipping rather than plain min/max so a single pole does not
 * flatten everything else into a line at the middle of the frame.
 *
 * @param points - sampled points; nulls are ignored.
 * @param clipPercent - fraction to trim from each tail.
 * @returns an inclusive y-range, always non-degenerate.
 */
export function autoRangeY(points: readonly (readonly [number, number | null])[], clipPercent = 0.02): Range {
  const values: number[] = []
  for (const [, y] of points) {
    if (y !== null && Number.isFinite(y)) values.push(y)
  }
  if (values.length === 0) return { yMin: -5, yMax: 5 }
  values.sort((a, b) => a - b)
  const cut = Math.floor(values.length * clipPercent)
  const lo = values[Math.min(cut, values.length - 1)] as number
  const hi = values[Math.max(0, values.length - 1 - cut)] as number
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { yMin: -5, yMax: 5 }
  if (hi - lo < 1e-9) {
    const pad = Math.max(1, Math.abs(hi) * 0.5)
    return { yMin: hi - pad, yMax: hi + pad }
  }
  const pad = (hi - lo) * 0.08
  return { yMin: lo - pad, yMax: hi + pad }
}

/**
 * The frozen y-range for a parameter sweep.
 *
 * Re-fitting the range on every frame produces the illusion that the *axes*
 * move while the curve stays put: sweeping amplitude A from 0.2 to 2 keeps the
 * wave filling the same band on screen with only the tick labels drifting.
 * Freezing the range at sweep start, sampled across the whole parameter box,
 * lets the curve visibly grow and shrink inside a still frame.
 *
 * @param compiled - the compiled expression.
 * @param params - current parameter values.
 * @param specs - slider bounds per parameter, `[min, max]`.
 * @param xRange - the x-window to sample over.
 * @returns padded bounds covering every reachable parameter value.
 */
export function freezeYRange(
  compiled: CompiledExpression,
  params: Readonly<Record<string, number>>,
  specs: Readonly<Record<string, readonly [number, number]>>,
  xRange: readonly [number, number],
): Range {
  const [xMin, xMax] = xRange
  const names = Object.keys(params)

  // No parameters to sweep: nothing can change shape, so fit as usual.
  if (names.length === 0) return autoRangeY(compiled.sample(xMin, xMax, 900, params))

  // Sample the corners of the parameter box: the extremes of every slider, plus
  // the all-at-min and all-at-max corners, which a multi-parameter sweep hits.
  const extremes: Scope[] = [{ ...params }]
  for (const name of names) {
    const bounds = specs[name]
    if (bounds === undefined) continue
    extremes.push({ ...params, [name]: bounds[0] })
    extremes.push({ ...params, [name]: bounds[1] })
  }
  const allMin: Record<string, number> = { ...params }
  const allMax: Record<string, number> = { ...params }
  for (const name of names) {
    const bounds = specs[name]
    if (bounds === undefined) continue
    allMin[name] = bounds[0]
    allMax[name] = bounds[1]
  }
  extremes.push(allMin, allMax)

  let lo = Infinity
  let hi = -Infinity
  for (const scope of extremes) {
    const local = autoRangeY(compiled.sample(xMin, xMax, 400, scope))
    if (Number.isFinite(local.yMin)) lo = Math.min(lo, local.yMin)
    if (Number.isFinite(local.yMax)) hi = Math.max(hi, local.yMax)
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return autoRangeY([])
  const pad = (hi - lo) * 0.06
  return { yMin: lo - pad, yMax: hi + pad }
}

/** Where one curve's samples land after clipping. */
export interface CurveGeometry {
  /** The expression this geometry was sampled from. */
  readonly expr: string
  /** Optional display label. */
  readonly label?: string
  /** Sampled points across the window. */
  readonly points: readonly Point[]
}

/** The tangent line at the probe point, in the tangent mode. */
export interface TangentGeometry {
  /** The probe abscissa. */
  readonly x: number
  /** f at the probe point. */
  readonly y: number
  /** The slope there. */
  readonly slope: number
}

/** The Riemann sum the area mode draws. */
export interface RiemannGeometry {
  /** Lower bound. */
  readonly a: number
  /** Upper bound. */
  readonly b: number
  /** Number of rectangles. */
  readonly n: number
  /** The finite sum of the rectangles. */
  readonly sum: number
  /** The exact integral, from composite Simpson. */
  readonly exact: number
  /** Rectangle tops as `[leftEdge, height]`. */
  readonly bars: readonly (readonly [number, number])[]
}

/** The Taylor expansion the series mode draws. */
export interface TaylorGeometry {
  /** The expansion point. */
  readonly center: number
  /** Highest degree. */
  readonly order: number
  /** Coefficients `c_k` for `c_k (x-a)^k`. */
  readonly coefficients: readonly number[]
  /** Sampled points of the polynomial. */
  readonly points: readonly Point[]
}

/** Everything the renderer needs for one frame. */
export interface SketchGeometry {
  /** The mode this geometry was produced for. */
  readonly mode: Mode
  /** The window in x. */
  readonly xRange: readonly [number, number]
  /** The window in y. */
  readonly yRange: Range
  /** The curves to draw. */
  readonly curves: readonly CurveGeometry[]
  /** Present only in the tangent mode. */
  readonly tangent?: TangentGeometry
  /** Present only in the area mode. */
  readonly riemann?: RiemannGeometry
  /** Present only in the series mode. */
  readonly taylor?: TaylorGeometry
}

/** Sampling density; high enough that curvature reads smoothly at any width. */
const SAMPLES = 900

/**
 * Parse `label, expr` or a bare `expr` from one comparison line.
 *
 * Exported because the browser card labels the same curves the Host resolved,
 * and a second parser would be a second answer to the same question.
 * @param line - one entry of the spec's `compare` list.
 * @returns the optional label plus the bare expression.
 */
export function splitCurveLine(line: string): { label?: string; expr: string } {
  const text = line.trim().replace(/^y\s*=\s*/i, '')
  const comma = text.indexOf(',')
  if (comma > 0 && !/[()+\-*/^]/.test(text.slice(0, comma))) {
    const label = text.slice(0, comma).trim()
    const expr = text.slice(comma + 1).trim().replace(/^y\s*=\s*/i, '')
    return expr.length > 0 ? { label, expr } : { expr: label }
  }
  return { expr: text }
}

/**
 * Resolve a sketch spec into concrete geometry.
 *
 * This is the single source of truth shared by the Host tool (which needs the
 * numbers to describe the plot in text) and the browser card (which draws it).
 * A spec that cannot be parsed yields an empty geometry rather than throwing:
 * a card with no curve is a better failure than a broken transcript.
 *
 * @param spec - the plot request.
 * @param options.taylorOrder - expansion order for the series mode.
 * @param options.center - expansion point for the series mode; `spec.center` wins.
 * @param options.probe - probe point for the tangent mode.
 * @param options.a - lower bound for the area mode.
 * @param options.b - upper bound for the area mode.
 * @param options.n - rectangle count for the area mode.
 * @param options.frozenYRange - hold this y-range instead of fitting one.
 * @returns the geometry to draw.
 */
export function resolveGeometry(
  spec: SketchSpec,
  options: {
    taylorOrder?: number
    center?: number
    probe?: number
    a?: number
    b?: number
    n?: number
    frozenYRange?: Range
  } = {},
): SketchGeometry {
  const mode = normalizeMode(spec.mode)
  const params: Record<string, number> = {}
  for (const [name, tuple] of Object.entries(spec.params ?? {})) {
    params[name] = tuple[2]
  }

  let compiled: CompiledExpression
  try {
    compiled = build(spec.expr)
  } catch {
    return { mode, xRange: [-6, 6], yRange: { yMin: -5, yMax: 5 }, curves: [] }
  }

  const xRange = resolveXRange(spec, mode, options.taylorOrder ?? 5, compiled)
  const [xMin, xMax] = xRange

  const sample = (expr: string): Point[] => {
    let c: CompiledExpression
    try {
      c = expr === spec.expr ? compiled : build(expr)
    } catch {
      return []
    }
    return c.sample(xMin, xMax, SAMPLES, params).map(([x, y]) => ({ x, y }))
  }

  const curves: CurveGeometry[] = []
  const first = sample(spec.expr)
  curves.push({ expr: spec.expr, points: first })
  for (const extra of spec.compare ?? []) {
    const { label, expr } = splitCurveLine(extra)
    curves.push({ expr, ...(label === undefined ? {} : { label }), points: sample(expr) })
  }

  const primary = first.map((p) => [p.x, p.y] as const)
  const yRange: Range = options.frozenYRange ?? autoRangeY(primary)

  const geometry: SketchGeometry = { mode, xRange, yRange, curves }

  if (mode === 'tangent') {
    const x = options.probe ?? (xMin + xMax) / 2
    const y = compiled.eval({ ...params, x })
    const slope = nthDerivativeAt(compiled.eval, x, params, 1)
    return { ...geometry, tangent: { x, y, slope } }
  }

  if (mode === 'riemann') {
    const a = options.a ?? 0
    const b = options.b ?? Math.PI
    const n = Math.max(1, Math.round(options.n ?? 15))
    const width = (b - a) / n
    const bars: (readonly [number, number])[] = []
    let sum = 0
    for (let i = 0; i < n; i++) {
      const left = a + i * width
      const height = compiled.eval({ ...params, x: left })
      const finite = Number.isFinite(height) ? height : 0
      bars.push([left, finite])
      sum += finite * width
    }
    const exact = Number.isFinite(compiled.eval({ ...params, x: a }))
      ? integrate(compiled.eval, a, b, params, 2000)
      : 0
    return { ...geometry, riemann: { a, b, n, sum, exact, bars } }
  }

  if (mode === 'taylor') {
    const center = options.center ?? spec.center ?? 0
    const order = options.taylorOrder ?? 5
    const coefficients = taylorCoefficients(compiled.eval, center, params, order)
    const poly = taylorEvaluator(coefficients, center)
    const points: Point[] = []
    const step = (xMax - xMin) / (SAMPLES - 1)
    for (let i = 0; i < SAMPLES; i++) {
      const x = xMin + step * i
      const y = poly(x)
      points.push({ x, y: Number.isFinite(y) ? y : null })
    }
    return { ...geometry, taylor: { center, order, coefficients, points } }
  }

  return geometry
}
