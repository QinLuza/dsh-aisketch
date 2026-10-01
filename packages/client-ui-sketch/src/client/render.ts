/**
 * Canvas rendering for the AISketch card.
 *
 * This is a typed port of the prototype's `renderer.js`. It lives in the
 * browser package rather than in `@gk/sketch-core` on purpose: the core owns
 * the maths (what curve to draw), this owns the pixels (how it looks). The
 * split keeps `sketch-core` headless-testable and lets each half be bundled
 * independently.
 *
 * Nothing here reads React or the DOM beyond the 2D context it is handed, so
 * the drawing can be exercised from a test with a stub context.
 */

/** Palette shared with the design tokens used across dsh surfaces. */
export const COLORS = {
  axis: '#9aa0a6',
  grid: 'rgba(0,0,0,.07)',
  curve: ['#378ADD', '#1D9E75', '#7F77DD', '#EF9F27', '#D4537E'],
  tangent: '#E24B4A',
  point: '#E24B4A',
  rect: 'rgba(55,138,221,.24)',
  rectEdge: '#378ADD',
  text: '#5f6368',
} as const

/** One math-space point; a null `y` marks a gap the stroke must not cross. */
export type Sample = readonly [number, number | null]

/** One named data series for the chart modes. */
export interface Series {
  readonly label: string
  readonly data: readonly number[]
}

/** A viewport describing the visible math region. */
export class Viewport {
  /** @param xMin,xMax,yMin,yMax - math-space bounds. */
  constructor(
    readonly xMin: number,
    readonly xMax: number,
    readonly yMin: number,
    readonly yMax: number,
  ) {}

  /** Canvas size in device-independent pixels; set by {@link fit}. */
  width = 0
  /** Canvas size in device-independent pixels; set by {@link fit}. */
  height = 0

  /**
   * Attach the pixel size.
   * @param width - canvas width.
   * @param height - canvas height.
   * @returns this, for chaining.
   */
  fit(width: number, height: number): this {
    this.width = width
    this.height = height
    return this
  }

  /** @returns x pixel for a math x. */
  px(x: number): number {
    return ((x - this.xMin) / (this.xMax - this.xMin)) * this.width
  }

  /** @returns y pixel for a math y (canvas y grows downward). */
  py(y: number): number {
    return this.height - ((y - this.yMin) / (this.yMax - this.yMin)) * this.height
  }

  /** @returns math x for a canvas pixel; the inverse of {@link px}. */
  xAt(px: number): number {
    return this.xMin + (px / this.width) * (this.xMax - this.xMin)
  }

  /** @returns math y for a canvas pixel; the inverse of {@link py}. */
  yAt(py: number): number {
    return this.yMin + ((this.height - py) / this.height) * (this.yMax - this.yMin)
  }
}

/**
 * Pick a "nice" axis step close to a target, from the 1/2/5 progression.
 * @param target - desired step size in math units.
 * @returns a human-friendly step.
 */
function niceStep(target: number): number {
  const exp = Math.floor(Math.log10(target))
  const base = target / 10 ** exp
  const mult = base < 1.5 ? 1 : base < 3.5 ? 2 : base < 7.5 ? 5 : 10
  return mult * 10 ** exp
}

/** @returns a tick label with just enough decimals for the given step. */
function formatTick(value: number, step: number): string {
  const decimals = Math.max(0, Math.min(4, -Math.floor(Math.log10(step))))
  return value.toFixed(decimals)
}

/**
 * Draw grid lines, axes, and tick labels for the current viewport.
 * @param ctx - 2D context.
 * @param vp - a fitted viewport.
 */
export function drawAxes(ctx: CanvasRenderingContext2D, vp: Viewport): void {
  const { width: w, height: h } = vp
  ctx.clearRect(0, 0, w, h)
  ctx.lineWidth = 1

  const xStep = niceStep((vp.xMax - vp.xMin) / 8)
  const yStep = niceStep((vp.yMax - vp.yMin) / 6)

  ctx.strokeStyle = COLORS.grid
  ctx.beginPath()
  for (let x = Math.ceil(vp.xMin / xStep) * xStep; x <= vp.xMax; x += xStep) {
    const px = Math.round(vp.px(x)) + 0.5
    ctx.moveTo(px, 0)
    ctx.lineTo(px, h)
  }
  for (let y = Math.ceil(vp.yMin / yStep) * yStep; y <= vp.yMax; y += yStep) {
    const py = Math.round(vp.py(y)) + 0.5
    ctx.moveTo(0, py)
    ctx.lineTo(w, py)
  }
  ctx.stroke()

  // Axes sit at the origin when visible, otherwise pin to the nearest edge.
  const xAxisY = Math.round(vp.py(Math.min(Math.max(0, vp.yMin), vp.yMax))) + 0.5
  const yAxisX = Math.round(vp.px(Math.min(Math.max(0, vp.xMin), vp.xMax))) + 0.5
  ctx.strokeStyle = COLORS.axis
  ctx.beginPath()
  ctx.moveTo(0, xAxisY)
  ctx.lineTo(w, xAxisY)
  ctx.moveTo(yAxisX, 0)
  ctx.lineTo(yAxisX, h)
  ctx.stroke()

  ctx.fillStyle = COLORS.text
  ctx.font = '11px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  for (let x = Math.ceil(vp.xMin / xStep) * xStep; x <= vp.xMax; x += xStep) {
    if (Math.abs(x) < xStep / 100) continue
    ctx.fillText(formatTick(x, xStep), vp.px(x), Math.min(xAxisY + 4, h - 14))
  }
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (let y = Math.ceil(vp.yMin / yStep) * yStep; y <= vp.yMax; y += yStep) {
    if (Math.abs(y) < yStep / 100) continue
    ctx.fillText(formatTick(y, yStep), Math.max(yAxisX - 4, 28), vp.py(y))
  }
}

/**
 * Draw one sampled curve. Gaps (nulls) break the stroke instead of connecting.
 * @param ctx - 2D context.
 * @param vp - viewport.
 * @param points - `[x, y|null]` pairs.
 * @param color - stroke color.
 * @param lineWidth - stroke width.
 * @param dash - optional dash pattern.
 */
export function drawCurve(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  points: readonly Sample[],
  color: string,
  lineWidth = 2,
  dash: readonly number[] = [],
): void {
  ctx.strokeStyle = color
  ctx.lineWidth = lineWidth
  ctx.setLineDash([...dash])
  ctx.beginPath()
  let pen = false
  for (const [x, y] of points) {
    if (y === null) {
      pen = false
      continue
    }
    const sx = vp.px(x)
    const sy = vp.py(y)
    if (!pen) {
      ctx.moveTo(sx, sy)
      pen = true
    } else {
      ctx.lineTo(sx, sy)
    }
  }
  ctx.stroke()
  ctx.setLineDash([])
}

/**
 * Draw a highlighted point with an optional label.
 * @param ctx - 2D context.
 * @param vp - viewport.
 * @param x,y - math coordinates.
 * @param label - optional text.
 * @param color - fill color.
 */
export function drawPoint(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  x: number,
  y: number,
  label: string | undefined,
  color: string = COLORS.point,
): void {
  const sx = vp.px(x)
  const sy = vp.py(y)
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(sx, sy, 4.5, 0, Math.PI * 2)
  ctx.fill()
  if (label !== undefined && label !== '') {
    ctx.fillStyle = color
    ctx.font = '12px system-ui, sans-serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'bottom'
    ctx.fillText(label, sx + 8, sy - 6)
  }
}

/**
 * Draw Riemann rectangles for an integral approximation.
 * @param ctx - 2D context.
 * @param vp - viewport.
 * @param evaluate - the compiled evaluator, already bound to the current params.
 * @param a,b - integration bounds.
 * @param n - rectangle count.
 */
export function drawRiemann(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  evaluate: (x: number) => number,
  a: number,
  b: number,
  n: number,
): void {
  const step = (b - a) / n
  ctx.fillStyle = COLORS.rect
  ctx.strokeStyle = COLORS.rectEdge
  ctx.lineWidth = 1
  for (let k = 0; k < n; k++) {
    const mid = a + (k + 0.5) * step
    const hgt = evaluate(mid)
    if (!Number.isFinite(hgt)) continue
    const x0 = vp.px(a + k * step)
    const x1 = vp.px(a + (k + 1) * step)
    const y0 = vp.py(0)
    const y1 = vp.py(hgt)
    const top = Math.min(y0, y1)
    const height = Math.abs(y1 - y0)
    ctx.fillRect(x0, top, x1 - x0, height)
    if (n <= 40) ctx.strokeRect(x0 + 0.5, top + 0.5, x1 - x0 - 1, height - 1)
  }
}

/**
 * Choose nice bounds for a categorical/numeric data chart.
 * @param values - all numbers across every series.
 * @returns `{min, max, step}` for the value axis, always including zero.
 */
export function niceDataRange(values: readonly number[]): { min: number; max: number; step: number } {
  const finite = values.filter((v) => Number.isFinite(v))
  if (finite.length === 0) return { min: 0, max: 1, step: 0.25 }
  let lo = Math.min(0, ...finite)
  let hi = Math.max(0, ...finite)
  if (hi === lo) hi = lo + 1
  const step = niceStep((hi - lo) / 5)
  lo = Math.floor(lo / step) * step
  hi = Math.ceil(hi / step) * step
  return { min: lo, max: hi, step }
}

/** Chart kinds the data mode can draw. */
export type ChartType = 'line' | 'bar' | 'scatter' | 'pie'

/** Left gutter reserved for value labels. */
const CHART_PAD_LEFT = 42

/**
 * @param vp - viewport.
 * @param i - category index.
 * @param slots - category count.
 * @returns the pixel x of the centre of category `i`.
 */
export function categoryCenterX(vp: Viewport, i: number, slots: number): number {
  return CHART_PAD_LEFT + ((vp.width - CHART_PAD_LEFT) / Math.max(1, slots)) * (i + 0.5)
}

/**
 * Render a Cartesian data chart (line / bar / scatter / area).
 *
 * Values are drawn as a sequence of categories; this is deliberately separate
 * from the function plotter, which samples a continuous expression instead.
 * The plot region is inset from the canvas so axis labels and category
 * captions have somewhere to live.
 *
 * @param ctx - 2D context.
 * @param vp - a fitted viewport.
 * @param series - the named series to draw.
 * @param type - which chart form to use.
 */
export function drawCartesianChart(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  series: readonly Series[],
  type: Exclude<ChartType, 'pie'>,
): void {
  const all = series.flatMap((s) => [...s.data])
  const { min, max, step } = niceDataRange(all)

  // Gutters: left for value labels, bottom and top for category captions.
  const padTop = 16
  const padBottom = 34
  const plotW = vp.width - CHART_PAD_LEFT
  const plotH = vp.height - padTop - padBottom
  const valueToY = (v: number): number => padTop + plotH - ((v - min) / (max - min)) * plotH

  const slots = Math.max(1, ...series.map((s) => s.data.length))
  const slotWidth = plotW / slots

  ctx.clearRect(0, 0, vp.width, vp.height)
  ctx.strokeStyle = COLORS.grid
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let v = min; v <= max + 1e-9; v += step) {
    const y = Math.round(valueToY(v)) + 0.5
    ctx.moveTo(CHART_PAD_LEFT, y)
    ctx.lineTo(vp.width, y)
  }
  ctx.stroke()

  // Zero baseline, emphasised when the data crosses zero.
  if (min < 0 && max > 0) {
    const y = Math.round(valueToY(0)) + 0.5
    ctx.strokeStyle = COLORS.axis
    ctx.beginPath()
    ctx.moveTo(CHART_PAD_LEFT, y)
    ctx.lineTo(vp.width, y)
    ctx.stroke()
  }

  // Value axis labels and the axis line itself.
  ctx.strokeStyle = COLORS.axis
  ctx.beginPath()
  ctx.moveTo(CHART_PAD_LEFT + 0.5, padTop)
  ctx.lineTo(CHART_PAD_LEFT + 0.5, padTop + plotH)
  ctx.stroke()

  ctx.fillStyle = COLORS.text
  ctx.font = '11px system-ui, sans-serif'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (let v = min; v <= max + 1e-9; v += step) {
    ctx.fillText(formatTick(v, step), CHART_PAD_LEFT - 6, valueToY(v))
  }

  if (type === 'bar') {
    const groupWidth = slotWidth * 0.7
    const barWidth = groupWidth / series.length
    series.forEach((s, si) => {
      ctx.fillStyle = COLORS.curve[si % COLORS.curve.length] ?? COLORS.curve[0]
      s.data.forEach((v, i) => {
        const cx = CHART_PAD_LEFT + slotWidth * (i + 0.5)
        const x = cx - groupWidth / 2 + barWidth * si
        const y = valueToY(v)
        const zero = valueToY(0)
        ctx.fillRect(x, Math.min(y, zero), barWidth - 2, Math.abs(zero - y))
      })
    })
    return
  }

  series.forEach((s, si) => {
    const color = COLORS.curve[si % COLORS.curve.length] ?? COLORS.curve[0]
    const pts = s.data.map((v, i): readonly [number, number] => [CHART_PAD_LEFT + slotWidth * (i + 0.5), valueToY(v)])
    if (type === 'line') {
      ctx.strokeStyle = color
      ctx.lineWidth = 2
      ctx.beginPath()
      pts.forEach(([x, y], i) => (i > 0 ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
      ctx.stroke()
      ctx.fillStyle = color
      for (const [x, y] of pts) {
        ctx.beginPath()
        ctx.arc(x, y, 3.5, 0, Math.PI * 2)
        ctx.fill()
      }
    } else {
      ctx.fillStyle = color
      for (const [x, y] of pts) {
        ctx.beginPath()
        ctx.arc(x, y, 4.5, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  })
}

/**
 * Render a pie chart. Only the first series is used; extra series are ignored.
 * @param ctx - 2D context.
 * @param vp - a fitted viewport.
 * @param series - the series whose data becomes the slices.
 */
export function drawPieChart(ctx: CanvasRenderingContext2D, vp: Viewport, series: readonly Series[]): void {
  const first = series[0]
  ctx.clearRect(0, 0, vp.width, vp.height)
  if (first === undefined) return
  const values = first.data
  const total = values.reduce((a, b) => a + Math.max(0, b), 0)
  if (total <= 0) return

  const cx = vp.width / 2
  const cy = vp.height / 2
  const radius = Math.min(vp.width, vp.height) * 0.36
  let angle = -Math.PI / 2

  values.forEach((v, i) => {
    const slice = (Math.max(0, v) / total) * Math.PI * 2
    ctx.fillStyle = COLORS.curve[i % COLORS.curve.length] ?? COLORS.curve[0]
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.arc(cx, cy, radius, angle, angle + slice)
    ctx.closePath()
    ctx.fill()

    // Label larger slices inside the arc so numbers stay readable.
    if (slice > 0.25) {
      const mid = angle + slice / 2
      const lx = cx + Math.cos(mid) * radius * 0.68
      const ly = cy + Math.sin(mid) * radius * 0.68
      ctx.fillStyle = '#fff'
      ctx.font = '12px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(`${Math.round((v / total) * 100)}%`, lx, ly)
    }
    angle += slice
  })
}
