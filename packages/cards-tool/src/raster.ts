/**
 * The preview rasterizer: a display list becomes pixels, with no image library.
 *
 * The whole point of `show_card`'s preview is that the model can *look* at what
 * it drew, and the Host has no DOM. Pulling in `sharp`/`resvg`/a headless
 * browser would make a card tool depend on a native binary or a browser, so the
 * shapes the engine emits are rasterized here instead: polygons and thick
 * polylines, scanline-filled, supersampled, then box-filtered down.
 *
 * Determinism is the same property the card itself relies on: the same display
 * list always produces the same pixels, so the preview a model reads back is the
 * card the human sees beside it.
 */

import type { DrawBlend, DrawDisplayList, DrawInk, InkGradient, Pt } from '@aisketch/cards-core'
import { encodePng } from './png.ts'

/** Pixels per canvas unit before downsampling; 2 means four samples per pixel. */
const DEFAULT_SUPERSAMPLE = 2

/** Upper bound on the long edge of the rendered buffer, so a huge canvas stays cheap. */
const MAX_BUFFER_EDGE = 2400

/** A rasterized image, row-major RGBA. */
export interface RasterImage {
  readonly width: number
  readonly height: number
  readonly rgba: Uint8Array
}

/** Rasterizer tuning. */
export interface RasterOptions {
  /** Samples per canvas unit on each axis; defaults to 2. */
  readonly supersample?: number
  /** Cap on the long edge of the working buffer, in pixels. */
  readonly maxBufferEdge?: number
}

/** Linear RGB buffer while painting; the background is opaque, so only RGB is tracked. */
interface Canvas {
  readonly width: number
  readonly height: number
  readonly rgb: Float32Array
}

/** Parse `#rgb`/`#rrggbb` into 0..255 components. */
function parseColor(color: string): readonly [number, number, number] {
  const hex = color.trim().replace(/^#/u, '')
  if (/^[0-9a-f]{3}$/iu.test(hex)) {
    const r = Number.parseInt(hex.charAt(0).repeat(2), 16)
    const g = Number.parseInt(hex.charAt(1).repeat(2), 16)
    const b = Number.parseInt(hex.charAt(2).repeat(2), 16)
    return [r, g, b]
  }
  if (/^[0-9a-f]{6}$/iu.test(hex)) {
    return [
      Number.parseInt(hex.slice(0, 2), 16),
      Number.parseInt(hex.slice(2, 4), 16),
      Number.parseInt(hex.slice(4, 6), 16),
    ]
  }
  // A theme token that escaped resolution stays visible rather than throwing:
  // a grey blob is a better debugging signal than a failed card.
  return [128, 128, 128]
}

/**
 * Blend one channel of a source color with an opaque backdrop, in 0..255.
 *
 * These are the CSS compositing formulas, evaluated on floats so a stack of
 * translucent washes does not quantize into bands. On an opaque backdrop the
 * result is simply `backdrop*(1-a) + blend(backdrop, source)*a`.
 * @param backdrop - the color already in the buffer.
 * @param source - the ink being painted.
 * @param mode - the element's blend mode.
 * @returns the blended channel, 0..255.
 */
function blendChannel(backdrop: number, source: number, mode: DrawBlend): number {
  if (mode === 'normal') return source
  const b = backdrop / 255
  const s = source / 255
  switch (mode) {
    case 'multiply':
      return b * s * 255
    case 'screen':
      return (b + s - b * s) * 255
    case 'overlay':
      return (b <= 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s)) * 255
    case 'soft-light': {
      const d = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b)
      return (s <= 0.5 ? b - (1 - 2 * s) * b * (1 - b) : b + (2 * s - 1) * (d - b)) * 255
    }
    default:
      return source
  }
}

/**
 * Composite one source color onto the buffer with an alpha and a blend mode.
 * @param buffer - the RGB buffer.
 * @param offset - the pixel's first channel.
 * @param rgb - the source color, 0..255.
 * @param alpha - source alpha, 0..1.
 * @param mode - the element's blend mode.
 */
function composite(buffer: Float32Array, offset: number, rgb: readonly [number, number, number], alpha: number, mode: DrawBlend): void {
  if (alpha <= 0) return
  const inv = 1 - alpha
  for (let channel = 0; channel < 3; channel += 1) {
    const base = buffer[offset + channel]!
    buffer[offset + channel] = base * inv + blendChannel(base, rgb[channel]!, mode) * alpha
  }
}

/**
 * Paint one span of a scanline with a constant color and alpha.
 * @param canvas - the target buffer.
 * @param row - pixel row.
 * @param start - inclusive first pixel.
 * @param end - inclusive last pixel.
 * @param rgb - fill color.
 * @param alpha - fill opacity.
 * @param mode - blend mode.
 */
function blendSpan(
  canvas: Canvas,
  row: number,
  start: number,
  end: number,
  rgb: readonly [number, number, number],
  alpha: number,
  mode: DrawBlend,
): void {
  const { width, rgb: buffer } = canvas
  const base = row * width * 3
  for (let x = Math.max(0, start); x <= Math.min(width - 1, end); x += 1) {
    composite(buffer, base + x * 3, rgb, alpha, mode)
  }
}

/** A paint the rasterizer can apply: one color, or a ramp sampled per pixel. */
type Paint =
  | { readonly kind: 'flat'; readonly rgb: readonly [number, number, number] }
  | { readonly kind: 'gradient'; readonly gradient: InkGradient }

/**
 * Sample a gradient at `t`, 0..1, interpolating color and stop alpha separately.
 *
 * Separating them is what SVG does for `stop-opacity`, and it is what makes a
 * glow fade to nothing at its edge instead of to a darker ring.
 * @param gradient - the resolved gradient.
 * @param t - position along the ramp, clamped to 0..1.
 * @returns the color and alpha at that position.
 */
function sampleGradient(gradient: InkGradient, t: number): { readonly rgb: readonly [number, number, number]; readonly alpha: number } {
  const stops = gradient.stops
  const first = stops[0]
  const last = stops[stops.length - 1]
  if (first === undefined || last === undefined) return { rgb: [0, 0, 0], alpha: 1 }
  const clamped = Math.min(1, Math.max(0, t))
  let left = first
  let right = last
  for (let index = 0; index + 1 < stops.length; index += 1) {
    const from = stops[index]!
    const to = stops[index + 1]!
    if (clamped >= from.offset && clamped <= to.offset) {
      left = from
      right = to
      break
    }
  }
  const span = right.offset - left.offset
  const local = span <= 0 ? 0 : (clamped - left.offset) / span
  const fromRgb = parseColor(left.color)
  const toRgb = parseColor(right.color)
  return {
    rgb: [
      fromRgb[0] + (toRgb[0] - fromRgb[0]) * local,
      fromRgb[1] + (toRgb[1] - fromRgb[1]) * local,
      fromRgb[2] + (toRgb[2] - fromRgb[2]) * local,
    ],
    alpha: left.opacity + (right.opacity - left.opacity) * local,
  }
}

/**
 * The gradient's parameter at a buffer pixel, as a function of x for one row.
 * @param gradient - the resolved gradient, in canvas units.
 * @param scaleX - buffer pixels per canvas unit, horizontally.
 * @param scaleY - buffer pixels per canvas unit, vertically.
 * @returns a sampler of `t` in 0..1 for any x at that row.
 */
function gradientAxis(gradient: InkGradient, scaleX: number, scaleY: number): (x: number, row: number) => number {
  if (gradient.type === 'linear') {
    const x1 = gradient.x1 * scaleX
    const y1 = gradient.y1 * scaleY
    const dx = gradient.x2 * scaleX - x1
    const dy = gradient.y2 * scaleY - y1
    const length = dx * dx + dy * dy
    if (length <= 0) return () => 0
    return (x, row) => ((x - x1) * dx + (row - y1) * dy) / length
  }
  const cx = gradient.cx * scaleX
  const cy = gradient.cy * scaleY
  const r = Math.max(gradient.r * ((scaleX + scaleY) / 2), 0.01)
  return (x, row) => Math.hypot(x - cx, row - cy) / r
}

/**
 * Paint one span of a scanline with a gradient sampled per pixel.
 * @param canvas - the target buffer.
 * @param row - pixel row.
 * @param start - inclusive first pixel.
 * @param end - inclusive last pixel.
 * @param gradient - the resolved gradient.
 * @param alpha - element-level fill opacity, multiplied into each stop's alpha.
 * @param axis - the gradient parameter at a pixel.
 */
function blendSpanGradient(
  canvas: Canvas,
  row: number,
  start: number,
  end: number,
  gradient: InkGradient,
  alpha: number,
  axis: (x: number, row: number) => number,
  mode: DrawBlend,
): void {
  const { width, rgb: buffer } = canvas
  const sampleY = row + 0.5
  for (let x = Math.max(0, start); x <= Math.min(width - 1, end); x += 1) {
    const sample = sampleGradient(gradient, axis(x, sampleY))
    composite(buffer, (row * width + x) * 3, sample.rgb, alpha * sample.alpha, mode)
  }
}

/**
 * Scanline-fill a polygon, even-odd.
 * @param canvas - the target buffer.
 * @param points - polygon vertices in buffer pixels.
 * @param paint - flat color or gradient.
 * @param alpha - fill opacity.
 * @param scaleX - buffer pixels per canvas unit, horizontally.
 * @param scaleY - buffer pixels per canvas unit, vertically.
 */
/**
 * Fill a polygon softly: rasterize its coverage, blur the coverage, composite.
 *
 * Blurring coverage rather than pixels is what makes a glow cheap: alpha is one
 * float per pixel and the paint (flat, or a gradient sampled at that same pixel)
 * is applied afterwards, so a blurred gradient stays a gradient.
 */
function fillPolygonSoft(
  canvas: Canvas,
  points: readonly Pt[],
  paint: Paint,
  alpha: number,
  scaleX: number,
  scaleY: number,
  mode: DrawBlend,
  blur: number,
): void {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const point of points) {
    if (point.x < minX) minX = point.x
    if (point.y < minY) minY = point.y
    if (point.x > maxX) maxX = point.x
    if (point.y > maxY) maxY = point.y
  }
  const pad = Math.ceil(blur * 1.5)
  const originX = Math.max(0, Math.floor(minX - pad))
  const originY = Math.max(0, Math.floor(minY - pad))
  const width = Math.min(canvas.width, Math.ceil(maxX + pad)) - originX
  const height = Math.min(canvas.height, Math.ceil(maxY + pad)) - originY
  if (width <= 0 || height <= 0) return
  const mask = new Float32Array(width * height)
  fillMask(mask, width, height, points.map(point => ({ x: point.x - originX, y: point.y - originY })))
  blurMask(mask, width, height, blur / 2)
  const axis = paint.kind === 'gradient' ? gradientAxis(paint.gradient, scaleX, scaleY) : undefined
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const coverage = mask[row * width + column]!
      if (coverage <= 0.002) continue
      const offset = ((originY + row) * canvas.width + originX + column) * 3
      if (paint.kind === 'flat') {
        composite(canvas.rgb, offset, paint.rgb, alpha * coverage, mode)
      } else if (axis !== undefined) {
        const sample = sampleGradient(paint.gradient, axis(originX + column + 0.5, originY + row + 0.5))
        composite(canvas.rgb, offset, sample.rgb, alpha * sample.alpha * coverage, mode)
      }
    }
  }
}

function fillPolygon(
  canvas: Canvas,
  points: readonly Pt[],
  paint: Paint,
  alpha: number,
  scaleX: number,
  scaleY: number,
  mode: DrawBlend,
  blur = 0,
): void {
  if (points.length < 3) return
  if (blur > 0) {
    fillPolygonSoft(canvas, points, paint, alpha, scaleX, scaleY, mode, blur)
    return
  }
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const point of points) {
    if (point.y < minY) minY = point.y
    if (point.y > maxY) maxY = point.y
  }
  const firstRow = Math.max(0, Math.floor(minY))
  const lastRow = Math.min(canvas.height - 1, Math.ceil(maxY))
  const axis = paint.kind === 'gradient' ? gradientAxis(paint.gradient, scaleX, scaleY) : undefined
  const crossings: number[] = []
  for (let row = firstRow; row <= lastRow; row += 1) {
    const sampleY = row + 0.5
    crossings.length = 0
    for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
      const a = points[i]!
      const b = points[j]!
      if ((a.y > sampleY) === (b.y > sampleY)) continue
      crossings.push(a.x + ((sampleY - a.y) / (b.y - a.y)) * (b.x - a.x))
    }
    if (crossings.length < 2) continue
    crossings.sort((left, right) => left - right)
    for (let index = 0; index + 1 < crossings.length; index += 2) {
      const from = Math.ceil(crossings[index]! - 0.5)
      const to = Math.floor(crossings[index + 1]! - 0.5)
      if (paint.kind === 'gradient' && axis !== undefined) {
        blendSpanGradient(canvas, row, from, to, paint.gradient, alpha, axis, mode)
      } else if (paint.kind === 'flat') {
        blendSpan(canvas, row, from, to, paint.rgb, alpha, mode)
      }
    }
  }
}

/** Fill a circle as a 16-gon: round caps and dots are the only circles here. */
function circlePoints(centerX: number, centerY: number, radius: number): Pt[] {
  const points: Pt[] = []
  for (let index = 0; index < 16; index += 1) {
    const angle = (index / 16) * Math.PI * 2
    points.push({ x: centerX + radius * Math.cos(angle), y: centerY + radius * Math.sin(angle) })
  }
  return points
}

/** Parse a `stroke-dasharray` value into alternating on/off lengths. */
function parseDashArray(value: string): readonly number[] {
  const numbers = value.split(/[\s,]+/u).map(part => Number.parseFloat(part)).filter(part => Number.isFinite(part) && part > 0)
  return numbers.length === 0 ? [] : numbers
}

/**
 * Split a centerline into the runs a dash pattern actually paints.
 * @param points - the centerline.
 * @param pattern - alternating on/off lengths, in buffer pixels.
 * @returns the painted runs.
 */
function dashRuns(points: readonly Pt[], pattern: readonly number[]): readonly (readonly Pt[])[] {
  if (pattern.length === 0) return [points]
  const runs: Pt[][] = []
  let patternIndex = 0
  let remaining = pattern[0]!
  let painting = true
  let current: Pt[] = painting ? [points[0]!] : []
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1]!
    const to = points[index]!
    const length = Math.hypot(to.x - from.x, to.y - from.y)
    let consumed = 0
    while (consumed < length) {
      const step = Math.min(remaining, length - consumed)
      consumed += step
      remaining -= step
      const t = length === 0 ? 1 : consumed / length
      const at = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }
      if (Math.abs(remaining) < 1e-9) {
        if (painting) {
          current.push(at)
          runs.push(current)
          current = []
        } else {
          current = [at]
        }
        painting = !painting
        patternIndex = (patternIndex + 1) % pattern.length
        remaining = pattern[patternIndex]!
      } else if (painting) {
        current.push(at)
      }
    }
  }
  if (painting && current.length > 1) runs.push(current)
  return runs
}

/** The four corners of one thick segment. */
function segmentQuad(from: Pt, to: Pt, halfWidth: number): Pt[] {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.hypot(dx, dy) || 1
  const nx = (-dy / length) * halfWidth
  const ny = (dx / length) * halfWidth
  return [
    { x: from.x + nx, y: from.y + ny },
    { x: to.x + nx, y: to.y + ny },
    { x: to.x - nx, y: to.y - ny },
    { x: from.x - nx, y: from.y - ny },
  ]
}

/**
 * Paint a thick centerline.
 *
 * Each segment is filled as a quad rather than stroked, which keeps the whole
 * pipeline on one primitive. Segments of one line meet at shared endpoints and
 * overlap slightly; the line is therefore painted at full alpha into a local
 * coverage mask first and composited once, so a translucent marker does not go
 * darker at every joint.
 * @param canvas - the target buffer.
 * @param points - the centerline in buffer pixels.
 * @param width - stroke width in buffer pixels.
 * @param rgb - stroke color.
 * @param alpha - stroke opacity.
 * @param cap - end cap style.
 * @param dash - dash pattern, in buffer pixels.
 */
function strokePolyline(
  canvas: Canvas,
  points: readonly Pt[],
  width: number,
  rgb: readonly [number, number, number],
  alpha: number,
  cap: 'round' | 'butt',
  dash: readonly number[],
  mode: DrawBlend = 'normal',
  blur = 0,
): void {
  if (points.length < 1 || width <= 0) return
  const halfWidth = Math.max(width / 2, 0.35)
  const runs = points.length === 1 ? [[points[0]!, points[0]!]] : dashRuns(points, dash)
  if (runs.length === 0) return

  // Local coverage mask, so overlapping quads count once.
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  const touch = (point: Pt): void => {
    if (point.x < minX) minX = point.x
    if (point.y < minY) minY = point.y
    if (point.x > maxX) maxX = point.x
    if (point.y > maxY) maxY = point.y
  }
  for (const run of runs) for (const point of run) touch(point)
  const pad = halfWidth + 2 + (blur > 0 ? Math.ceil(blur * 1.5) : 0)
  const originX = Math.max(0, Math.floor(minX - pad))
  const originY = Math.max(0, Math.floor(minY - pad))
  const endX = Math.min(canvas.width, Math.ceil(maxX + pad))
  const endY = Math.min(canvas.height, Math.ceil(maxY + pad))
  const maskWidth = endX - originX
  const maskHeight = endY - originY
  if (maskWidth <= 0 || maskHeight <= 0) return

  const mask = new Float32Array(maskWidth * maskHeight)
  const paintMask = (polygon: readonly Pt[]): void => {
    const local = polygon.map(point => ({ x: point.x - originX, y: point.y - originY }))
    fillMask(mask, maskWidth, maskHeight, local)
  }
  for (const run of runs) {
    if (run.length === 1) {
      paintMask(circlePoints(run[0]!.x, run[0]!.y, halfWidth))
      continue
    }
    for (let index = 1; index < run.length; index += 1) {
      paintMask(segmentQuad(run[index - 1]!, run[index]!, halfWidth))
    }
    if (cap === 'round') {
      paintMask(circlePoints(run[0]!.x, run[0]!.y, halfWidth))
      paintMask(circlePoints(run[run.length - 1]!.x, run[run.length - 1]!.y, halfWidth))
    }
  }

  if (blur > 0) blurMask(mask, maskWidth, maskHeight, blur / 2)

  const { width: canvasWidth, rgb: buffer } = canvas
  for (let row = 0; row < maskHeight; row += 1) {
    const base = (originY + row) * canvasWidth * 3
    const maskBase = row * maskWidth
    for (let column = 0; column < maskWidth; column += 1) {
      const coverage = mask[maskBase + column]!
      if (coverage <= 0.002) continue
      composite(buffer, base + (originX + column) * 3, rgb, alpha * coverage, mode)
    }
  }
}

/** One horizontal box-blur pass with edge clamping. */
function boxBlurHorizontal(source: Float32Array, target: Float32Array, width: number, height: number, radius: number): void {
  const span = radius * 2 + 1
  for (let y = 0; y < height; y += 1) {
    const row = y * width
    let sum = 0
    for (let x = -radius; x <= radius; x += 1) {
      sum += source[row + Math.min(width - 1, Math.max(0, x))]!
    }
    for (let x = 0; x < width; x += 1) {
      target[row + x] = sum / span
      sum += source[row + Math.min(width - 1, Math.max(0, x + radius + 1))]!
      sum -= source[row + Math.min(width - 1, Math.max(0, x - radius))]!
    }
  }
}

/** One vertical box-blur pass with edge clamping. */
function boxBlurVertical(source: Float32Array, target: Float32Array, width: number, height: number, radius: number): void {
  const span = radius * 2 + 1
  for (let x = 0; x < width; x += 1) {
    let sum = 0
    for (let y = -radius; y <= radius; y += 1) {
      sum += source[Math.min(height - 1, Math.max(0, y)) * width + x]!
    }
    for (let y = 0; y < height; y += 1) {
      target[y * width + x] = sum / span
      sum += source[Math.min(height - 1, Math.max(0, y + radius + 1)) * width + x]!
      sum -= source[Math.min(height - 1, Math.max(0, y - radius)) * width + x]!
    }
  }
}

/**
 * Soften a coverage mask with three box passes, which is a Gaussian to the eye.
 *
 * The mask is already one number per pixel, so blurring it and multiplying into
 * the paint's alpha is the same thing as blurring the element in isolation --
 * without an RGBA scratch buffer for every glow.
 * @param mask - coverage in 0..1, blurred in place.
 * @param width - mask width in pixels.
 * @param height - mask height in pixels.
 * @param radius - box radius in pixels; the resulting spread is about this size.
 */
function blurMask(mask: Float32Array, width: number, height: number, radius: number): void {
  const box = Math.max(1, Math.round(radius))
  if (box < 1 || width <= 0 || height <= 0) return
  const scratch = new Float32Array(mask.length)
  for (let pass = 0; pass < 3; pass += 1) {
    boxBlurHorizontal(mask, scratch, width, height, box)
    boxBlurVertical(scratch, mask, width, height, box)
  }
}

/** Fill a polygon into a binary coverage mask, saturated at one. */
function fillMask(mask: Float32Array, width: number, height: number, points: readonly Pt[]): void {
  if (points.length < 3) return
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const point of points) {
    if (point.y < minY) minY = point.y
    if (point.y > maxY) maxY = point.y
  }
  const crossings: number[] = []
  for (let row = Math.max(0, Math.floor(minY)); row <= Math.min(height - 1, Math.ceil(maxY)); row += 1) {
    const sampleY = row + 0.5
    crossings.length = 0
    for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
      const a = points[i]!
      const b = points[j]!
      if ((a.y > sampleY) === (b.y > sampleY)) continue
      crossings.push(a.x + ((sampleY - a.y) / (b.y - a.y)) * (b.x - a.x))
    }
    if (crossings.length < 2) continue
    crossings.sort((left, right) => left - right)
    const rowBase = row * width
    for (let index = 0; index + 1 < crossings.length; index += 2) {
      const start = Math.max(0, Math.ceil(crossings[index]! - 0.5))
      const end = Math.min(width - 1, Math.floor(crossings[index + 1]! - 0.5))
      for (let x = start; x <= end; x += 1) mask[rowBase + x] = 1
    }
  }
}

/** Paint one rectangle of the canvas. */
function fillRect(
  canvas: Canvas,
  x: number,
  y: number,
  w: number,
  h: number,
  rgb: readonly [number, number, number],
  alpha: number,
  mode: DrawBlend = 'normal',
): void {
  if (w <= 0 || h <= 0) return
  const firstRow = Math.max(0, Math.floor(y))
  const lastRow = Math.min(canvas.height - 1, Math.ceil(y + h) - 1)
  const start = Math.ceil(x - 0.5)
  const end = Math.floor(x + w - 0.5)
  if (end < start) return
  for (let row = firstRow; row <= lastRow; row += 1) blendSpan(canvas, row, start, end, rgb, alpha, mode)
}

/**
 * Paint one display-list primitive at a given scale.
 * @param canvas - the target buffer.
 * @param ink - the primitive.
 * @param scaleX - buffer pixels per canvas unit, horizontally.
 * @param scaleY - buffer pixels per canvas unit, vertically.
 */
function paintInk(canvas: Canvas, ink: DrawInk, scaleX: number, scaleY: number): void {
  const blur = ink.blur * ((scaleX + scaleY) / 2)
  if (ink.kind === 'block') {
    fillRect(canvas, ink.x * scaleX, ink.y * scaleY, ink.w * scaleX, ink.h * scaleY, parseColor(ink.color), ink.opacity, ink.blend)
    return
  }
  const points = ink.points.map(point => ({ x: point.x * scaleX, y: point.y * scaleY }))
  if (ink.kind === 'polygon') {
    const paint: Paint = ink.gradient === undefined
      ? { kind: 'flat', rgb: parseColor(ink.color) }
      : { kind: 'gradient', gradient: ink.gradient }
    fillPolygon(canvas, points, paint, ink.opacity, scaleX, scaleY, ink.blend, blur)
    return
  }
  const dash = ink.dasharray === undefined ? [] : parseDashArray(ink.dasharray).map(length => length * Math.min(scaleX, scaleY))
  strokePolyline(canvas, points, ink.width * Math.min(scaleX, scaleY), parseColor(ink.color), ink.opacity, ink.cap, dash, ink.blend, blur)
}

/**
 * Draw a display list into a supersampled buffer and box-filter it down.
 * @param list - the drawing's display list.
 * @param options - supersample and buffer-size tuning.
 * @returns the rasterized image, at the canvas's own size.
 */
export function rasterizeDisplayList(list: DrawDisplayList, options: RasterOptions = {}): RasterImage {
  const requested = Math.max(1, options.supersample ?? DEFAULT_SUPERSAMPLE)
  const edgeCap = options.maxBufferEdge ?? MAX_BUFFER_EDGE
  const longest = Math.max(list.width, list.height)
  const capped = Math.min(requested, Math.max(1, Math.floor(edgeCap / longest)))
  const supersample = Math.max(1, capped)

  const width = Math.max(1, Math.round(list.width * supersample))
  const height = Math.max(1, Math.round(list.height * supersample))
  const scaleX = width / list.width
  const scaleY = height / list.height

  const rgb = new Float32Array(width * height * 3)
  const background = parseColor(list.background)
  for (let index = 0; index < width * height; index += 1) {
    rgb[index * 3] = background[0]
    rgb[index * 3 + 1] = background[1]
    rgb[index * 3 + 2] = background[2]
  }
  const canvas: Canvas = { width, height, rgb }

  for (const ink of list.paints) paintInk(canvas, ink, scaleX, scaleY)

  const outWidth = Math.max(1, Math.round(list.width))
  const outHeight = Math.max(1, Math.round(list.height))
  const rgba = new Uint8Array(outWidth * outHeight * 4)
  const blockX = width / outWidth
  const blockY = height / outHeight
  for (let y = 0; y < outHeight; y += 1) {
    const rowStart = Math.floor(y * blockY)
    const rowEnd = Math.max(rowStart + 1, Math.min(height, Math.ceil((y + 1) * blockY)))
    for (let x = 0; x < outWidth; x += 1) {
      const columnStart = Math.floor(x * blockX)
      const columnEnd = Math.max(columnStart + 1, Math.min(width, Math.ceil((x + 1) * blockX)))
      let r = 0
      let g = 0
      let b = 0
      let samples = 0
      for (let sy = rowStart; sy < rowEnd; sy += 1) {
        const base = sy * width * 3
        for (let sx = columnStart; sx < columnEnd; sx += 1) {
          const offset = base + sx * 3
          r += rgb[offset]!
          g += rgb[offset + 1]!
          b += rgb[offset + 2]!
          samples += 1
        }
      }
      const target = (y * outWidth + x) * 4
      const divisor = samples === 0 ? 1 : samples
      rgba[target] = Math.round(r / divisor)
      rgba[target + 1] = Math.round(g / divisor)
      rgba[target + 2] = Math.round(b / divisor)
      rgba[target + 3] = 255
    }
  }
  return { width: outWidth, height: outHeight, rgba }
}

/**
 * Rasterize a display list straight to PNG bytes.
 * @param list - the drawing's display list.
 * @param options - supersample and buffer-size tuning.
 * @returns the PNG file bytes.
 */
export function rasterizeDisplayListPng(list: DrawDisplayList, options: RasterOptions = {}): Uint8Array {
  const image = rasterizeDisplayList(list, options)
  return encodePng(image.width, image.height, image.rgba)
}
