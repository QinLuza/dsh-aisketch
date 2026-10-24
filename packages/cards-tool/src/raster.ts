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

import type { DrawDisplayList, DrawInk, Pt } from '@aisketch/cards-core'
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
 * Paint one span of a scanline with a constant color and alpha.
 * @param canvas - the target buffer.
 * @param row - pixel row.
 * @param start - inclusive first pixel.
 * @param end - inclusive last pixel.
 */
function blendSpan(canvas: Canvas, row: number, start: number, end: number, rgb: readonly [number, number, number], alpha: number): void {
  const { width, rgb: buffer } = canvas
  const base = row * width * 3
  const inv = 1 - alpha
  for (let x = Math.max(0, start); x <= Math.min(width - 1, end); x += 1) {
    const offset = base + x * 3
    buffer[offset] = buffer[offset]! * inv + rgb[0] * alpha
    buffer[offset + 1] = buffer[offset + 1]! * inv + rgb[1] * alpha
    buffer[offset + 2] = buffer[offset + 2]! * inv + rgb[2] * alpha
  }
}

/**
 * Scanline-fill a polygon, even-odd.
 * @param canvas - the target buffer.
 * @param points - polygon vertices in buffer pixels.
 * @param rgb - fill color.
 * @param alpha - fill opacity.
 */
function fillPolygon(canvas: Canvas, points: readonly Pt[], rgb: readonly [number, number, number], alpha: number): void {
  if (points.length < 3) return
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const point of points) {
    if (point.y < minY) minY = point.y
    if (point.y > maxY) maxY = point.y
  }
  const firstRow = Math.max(0, Math.floor(minY))
  const lastRow = Math.min(canvas.height - 1, Math.ceil(maxY))
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
      blendSpan(canvas, row, Math.ceil(crossings[index]! - 0.5), Math.floor(crossings[index + 1]! - 0.5), rgb, alpha)
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
  const pad = halfWidth + 2
  const originX = Math.max(0, Math.floor(minX - pad))
  const originY = Math.max(0, Math.floor(minY - pad))
  const endX = Math.min(canvas.width, Math.ceil(maxX + pad))
  const endY = Math.min(canvas.height, Math.ceil(maxY + pad))
  const maskWidth = endX - originX
  const maskHeight = endY - originY
  if (maskWidth <= 0 || maskHeight <= 0) return

  const mask = new Uint8Array(maskWidth * maskHeight)
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

  const { width: canvasWidth, rgb: buffer } = canvas
  const inv = 1 - alpha
  for (let row = 0; row < maskHeight; row += 1) {
    const base = (originY + row) * canvasWidth * 3
    const maskBase = row * maskWidth
    for (let column = 0; column < maskWidth; column += 1) {
      if (mask[maskBase + column] === 0) continue
      const offset = base + (originX + column) * 3
      buffer[offset] = buffer[offset]! * inv + rgb[0] * alpha
      buffer[offset + 1] = buffer[offset + 1]! * inv + rgb[1] * alpha
      buffer[offset + 2] = buffer[offset + 2]! * inv + rgb[2] * alpha
    }
  }
}

/** Fill a polygon into a binary coverage mask, saturated at one. */
function fillMask(mask: Uint8Array, width: number, height: number, points: readonly Pt[]): void {
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
      for (let x = start; x <= end; x += 1) mask[rowBase + x] = 255
    }
  }
}

/** Paint one rectangle of the canvas. */
function fillRect(canvas: Canvas, x: number, y: number, w: number, h: number, rgb: readonly [number, number, number], alpha: number): void {
  if (w <= 0 || h <= 0) return
  const firstRow = Math.max(0, Math.floor(y))
  const lastRow = Math.min(canvas.height - 1, Math.ceil(y + h) - 1)
  const start = Math.ceil(x - 0.5)
  const end = Math.floor(x + w - 0.5)
  if (end < start) return
  for (let row = firstRow; row <= lastRow; row += 1) blendSpan(canvas, row, start, end, rgb, alpha)
}

/**
 * Paint one display-list primitive at a given scale.
 * @param canvas - the target buffer.
 * @param ink - the primitive.
 * @param scaleX - buffer pixels per canvas unit, horizontally.
 * @param scaleY - buffer pixels per canvas unit, vertically.
 */
function paintInk(canvas: Canvas, ink: DrawInk, scaleX: number, scaleY: number): void {
  const rgb = parseColor(ink.color)
  if (ink.kind === 'block') {
    fillRect(canvas, ink.x * scaleX, ink.y * scaleY, ink.w * scaleX, ink.h * scaleY, rgb, ink.opacity)
    return
  }
  const points = ink.points.map(point => ({ x: point.x * scaleX, y: point.y * scaleY }))
  if (ink.kind === 'polygon') {
    fillPolygon(canvas, points, rgb, ink.opacity)
    return
  }
  const dash = ink.dasharray === undefined ? [] : parseDashArray(ink.dasharray).map(length => length * Math.min(scaleX, scaleY))
  strokePolyline(canvas, points, ink.width * Math.min(scaleX, scaleY), rgb, ink.opacity, ink.cap, dash)
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
