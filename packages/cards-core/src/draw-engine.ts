/**
 * The `draw` engine (kernel copy; the browser half imports it through `@aisketch/cards-core`): pens, arc flattening, and hand-drawn wobble.
 *
 * Everything here is a pure function of the payload and a per-element seed, so
 * the same card draws the same pixels twice -- which is what lets a replayed
 * session show the identical sketch without a Host call. Nothing measures the
 * DOM, reads a global, or animates: the model ships centerlines and shapes, and
 * the engine decides what a fountain pen, a calligraphy nib or a pencil
 * actually looks like.
 *
 * The trust boundary stays here too: a payload's `d` string is parsed by
 * `@aisketch/cards-core`'s grammar and only the geometry it produces is emitted --
 * no markup is interpolated, nothing is evaluated.
 */

import { parseDrawPathData, resolveDrawColor } from './index.ts'
import type {
  DrawDash,
  DrawPathCommand,
  DrawPathElement,
  DrawPen,
  DrawPixelElement,
  DrawShapeElement,
  DrawShapeKind,
  DrawTapeElement,
} from './index.ts'

/** One point on a flattened centerline. */
export interface Pt {
  readonly x: number
  readonly y: number
}

/** Steps used to flatten one cubic segment. */
const CUBIC_STEPS = 12

/** Steps used to sample one elliptical arc. */
const ARC_STEPS = 18

/** Points used to sample a full ellipse. */
const ELLIPSE_POINTS = 48

/** How far a rough line may wander from its true position, in canvas units. */
const WOBBLE_AMPLITUDE = 1.35

/** Target length of one wobble subdivision, in canvas units. */
const WOBBLE_STEP = 26

/** Arrowhead size floor, so a thin arrow still reads as an arrow. */
const MIN_ARROW_HEAD = 9

/** Nib angle for the calligraphy pen: a vertical-ish flat nib, so downstrokes are thick and horizontals thin. */
const NIB_ANGLE = (65 * Math.PI) / 180

/** Round a coordinate to the hundredth, keeping emitted `d` strings compact. */
function f(value: number): string {
  return String(Math.round(value * 100) / 100)
}

/** Euclidean distance between two points. */
function distance(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/** Unit direction from `a` toward `b`. */
export function unit(a: Pt, b: Pt): Pt {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length = Math.hypot(dx, dy) || 1
  return { x: dx / length, y: dy / length }
}

/**
 * A seeded PRNG (mulberry32), so an element's wobble and grain are
 * reproducible: same payload, same pixels, replay included.
 * @param seed - the element's index plus one, so the first element is not starved.
 * @returns a function yielding numbers in [0, 1).
 */
export function rngFor(seed: number): () => number {
  let state = (Math.imul(seed, 0x9e3779b9) ^ 0x85ebca6b) >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Evaluate one cubic Bezier segment at `t`. */
function cubicAt(p0: Pt, c1: Pt, c2: Pt, p1: Pt, t: number): Pt {
  const u = 1 - t
  const a = u * u * u
  const b = 3 * u * u * t
  const c = 3 * u * t * t
  const d = t * t * t
  return {
    x: a * p0.x + b * c1.x + c * c2.x + d * p1.x,
    y: a * p0.y + b * c1.y + c * c2.y + d * p1.y,
  }
}

/**
 * Sample an SVG elliptical arc into points, endpoint form to center form.
 *
 * This is the F.6.5 conversion straight out of the SVG spec: scale the radii up
 * when the endpoints cannot be joined, then walk the arc's angle span. Sampling
 * the parametric ellipse directly avoids approximating the arc with cubics.
 * @param start - the current point, where the arc begins.
 * @param command - the normalized `A` command (absolute endpoint form).
 * @returns the sampled points after `start`, ending exactly at the arc's endpoint.
 */
function arcPoints(start: Pt, command: Extract<DrawPathCommand, { cmd: 'A' }>): Pt[] {
  const { rx, ry, rotation, large, sweep, x, y } = command
  const end: Pt = { x, y }
  if (rx === 0 || ry === 0 || (start.x === x && start.y === y)) return [end]
  const phi = (rotation * Math.PI) / 180
  const cosPhi = Math.cos(phi)
  const sinPhi = Math.sin(phi)
  const dx = (start.x - x) / 2
  const dy = (start.y - y) / 2
  const x1p = cosPhi * dx + sinPhi * dy
  const y1p = -sinPhi * dx + cosPhi * dy
  let rxs = Math.abs(rx)
  let rys = Math.abs(ry)
  const lambda = (x1p * x1p) / (rxs * rxs) + (y1p * y1p) / (rys * rys)
  if (lambda > 1) {
    const scale = Math.sqrt(lambda)
    rxs *= scale
    rys *= scale
  }
  const numerator = rxs * rxs * rys * rys - rxs * rxs * y1p * y1p - rys * rys * x1p * x1p
  const denominator = rxs * rxs * y1p * y1p + rys * rys * x1p * x1p
  const sign = large !== sweep ? 1 : -1
  const coef = denominator === 0 ? 0 : sign * Math.sqrt(Math.max(0, numerator / denominator))
  const cxp = (coef * rxs * y1p) / rys
  const cyp = (-coef * rys * x1p) / rxs
  const center: Pt = {
    x: cosPhi * cxp - sinPhi * cyp + (start.x + x) / 2,
    y: sinPhi * cxp + cosPhi * cyp + (start.y + y) / 2,
  }
  const ux = (x1p - cxp) / rxs
  const uy = (y1p - cyp) / rys
  const vx = (-x1p - cxp) / rxs
  const vy = (-y1p - cyp) / rys
  const theta1 = Math.atan2(uy, ux)
  let delta = Math.atan2(vy, vx) - theta1
  if (!sweep && delta > 0) delta -= Math.PI * 2
  if (sweep && delta < 0) delta += Math.PI * 2
  const points: Pt[] = []
  for (let step = 1; step <= ARC_STEPS; step += 1) {
    const theta = theta1 + delta * (step / ARC_STEPS)
    points.push({
      x: center.x + cosPhi * rxs * Math.cos(theta) - sinPhi * rys * Math.sin(theta),
      y: center.y + sinPhi * rxs * Math.cos(theta) + cosPhi * rys * Math.sin(theta),
    })
  }
  return points
}

/**
 * Flatten normalized path commands into one point list per subpath.
 *
 * Adjacent subpaths stay separate so an outline pen can wrap each stroke on its
 * own; a stroke pen simply concatenates them back into one `d` string with
 * several `M`s.
 * @param commands - normalized commands from `parseDrawPathData`.
 * @returns one polyline per drawn subpath.
 */
export function flattenPathCommands(commands: readonly DrawPathCommand[]): readonly Pt[][] {
  const subpaths: Pt[][] = []
  let current: Pt[] = []
  let cursor: Pt = { x: 0, y: 0 }
  let start: Pt = { x: 0, y: 0 }
  const closeCurrent = (): void => {
    if (current.length >= 1) subpaths.push(current)
    current = []
  }
  for (const command of commands) {
    switch (command.cmd) {
      case 'M':
        closeCurrent()
        current = [{ x: command.x, y: command.y }]
        cursor = { x: command.x, y: command.y }
        start = cursor
        break
      case 'L':
        current.push({ x: command.x, y: command.y })
        cursor = { x: command.x, y: command.y }
        break
      case 'C':
        for (let step = 1; step <= CUBIC_STEPS; step += 1) {
          current.push(cubicAt(
            cursor,
            { x: command.c1x, y: command.c1y },
            { x: command.c2x, y: command.c2y },
            { x: command.x, y: command.y },
            step / CUBIC_STEPS,
          ))
        }
        cursor = { x: command.x, y: command.y }
        break
      case 'A':
        for (const point of arcPoints(cursor, command)) current.push(point)
        cursor = { x: command.x, y: command.y }
        break
      case 'Z':
        current.push({ x: start.x, y: start.y })
        cursor = start
        closeCurrent()
        break
    }
  }
  closeCurrent()
  return subpaths
}

/**
 * The pen's rendering recipe: a constant-width stroke, or a variable-width
 * outline whose half-width depends on position along the stroke and direction.
 */
export type PenSpec =
  | {
    readonly kind: 'stroke'
    readonly width: number
    readonly opacity: number
    readonly cap: 'round' | 'butt'
    readonly grain: boolean
  }
  | {
    readonly kind: 'outline'
    readonly opacity: number
    readonly halfWidth: (t: number, angle: number) => number
  }

/** Fountain flow: the nib lands thin, fills in the belly, and lifts thin again. */
function fountainFlow(t: number): number {
  return Math.min(1, t / 0.12) * Math.min(1, (1 - t) / 0.3)
}

/**
 * Turn a pen choice and width into a rendering recipe.
 *
 * The named pens are the ones a note app puts in its tray: a ballpoint is a
 * plain thin line, a fountain pen tapers at both ends, a marker and a
 * highlighter are wide and translucent, a pencil is thin with grain, a brush
 * tapers hard, and a calligraphy nib is wide perpendicular to its nib angle.
 * @param pen - the element's pen.
 * @param width - the element's width, in canvas units.
 * @returns the recipe the renderer applies.
 */
export function penSpec(pen: DrawPen, width: number): PenSpec {
  switch (pen) {
    case 'ball':
      return { kind: 'stroke', width, opacity: 0.92, cap: 'round', grain: false }
    case 'marker':
      return { kind: 'stroke', width: width * 1.7, opacity: 0.42, cap: 'butt', grain: false }
    case 'highlighter':
      return { kind: 'stroke', width: width * 2.8, opacity: 0.28, cap: 'butt', grain: false }
    case 'pencil':
      return { kind: 'stroke', width: width * 0.62, opacity: 0.85, cap: 'round', grain: true }
    case 'fountain':
      return { kind: 'outline', opacity: 0.95, halfWidth: t => (width * (0.3 + 0.7 * fountainFlow(t))) / 2 }
    case 'brush':
      return { kind: 'outline', opacity: 0.95, halfWidth: t => (width * (0.14 + 0.86 * (1 - t) ** 1.15)) / 2 }
    case 'calligraphy':
      return {
        kind: 'outline',
        opacity: 0.95,
        halfWidth: (_t, angle) => (width * (0.1 + 0.9 * Math.abs(Math.cos(angle - NIB_ANGLE)))) / 2,
      }
  }
}

/** Drop consecutive duplicate points, so zero-length segments do not break normals. */
function dedupe(points: readonly Pt[]): Pt[] {
  const out: Pt[] = []
  for (const point of points) {
    const last = out[out.length - 1]
    if (last === undefined || Math.abs(last.x - point.x) > 1e-6 || Math.abs(last.y - point.y) > 1e-6) {
      out.push(point)
    }
  }
  return out
}

/**
 * The interior points of one round cap, from the left side, past the tip, to
 * the right side. The two side points themselves are supplied by the outline.
 */
function capPoints(center: Pt, ux: number, uy: number, radius: number): Pt[] {
  const steps = 6
  const points: Pt[] = []
  for (let step = 1; step < steps; step += 1) {
    const phi = (Math.PI / 2) * (1 - (2 * step) / steps)
    const cosPhi = Math.cos(phi)
    const sinPhi = Math.sin(phi)
    points.push({
      x: center.x + ux * radius * cosPhi - uy * radius * sinPhi,
      y: center.y + uy * radius * cosPhi + ux * radius * sinPhi,
    })
  }
  return points
}

/**
 * Build a filled outline for one variable-width stroke.
 *
 * Walks the centerline, offsets each point to either side by its half-width,
 * and closes the loop with round caps at both ends. Emitted as a closed
 * polyline: the points are dense enough that curve smoothing never pays for
 * itself, and a polyline is trivially deterministic.
 * @param points - the centerline.
 * @param halfWidth - half-width as a function of position along the stroke and local direction.
 * @returns a closed SVG path, or a small circle for a one-point dab.
 */
export function outlineSubpath(points: readonly Pt[], halfWidth: (t: number, angle: number) => number): string {
  const pts = dedupe(points)
  const first = pts[0]
  if (first === undefined) return ''
  if (pts.length === 1) {
    const radius = Math.max(halfWidth(0.5, 0), 0.4)
    const left = f(first.x - radius)
    const right = f(first.x + radius)
    return `M ${left} ${f(first.y)} A ${f(radius)} ${f(radius)} 0 1 1 ${right} ${f(first.y)} A ${f(radius)} ${f(radius)} 0 1 1 ${left} ${f(first.y)} Z`
  }
  const cumulative: number[] = [0]
  for (let index = 1; index < pts.length; index += 1) {
    cumulative.push(cumulative[index - 1]! + distance(pts[index - 1]!, pts[index]!))
  }
  const total = cumulative[cumulative.length - 1]!
  if (total <= 0) return ''
  const halfWidths: number[] = []
  const normals: Pt[] = []
  for (let index = 0; index < pts.length; index += 1) {
    const before = pts[Math.max(0, index - 1)]!
    const after = pts[Math.min(pts.length - 1, index + 1)]!
    const dx = after.x - before.x
    const dy = after.y - before.y
    const length = Math.hypot(dx, dy) || 1
    halfWidths.push(Math.max(halfWidth(cumulative[index]! / total, Math.atan2(dy, dx)), 0.3))
    normals.push({ x: -dy / length, y: dx / length })
  }
  const left: Pt[] = []
  const right: Pt[] = []
  for (let index = 0; index < pts.length; index += 1) {
    const point = pts[index]!
    const normal = normals[index]!
    const reach = halfWidths[index]!
    left.push({ x: point.x + normal.x * reach, y: point.y + normal.y * reach })
    right.push({ x: point.x - normal.x * reach, y: point.y - normal.y * reach })
  }
  const last = pts.length - 1
  const endDirection = unit(pts[last - 1]!, pts[last]!)
  const startDirection = unit(pts[0]!, pts[1]!)
  const outline: Pt[] = [...left]
  outline.push(...capPoints(pts[last]!, endDirection.x, endDirection.y, halfWidths[last]!))
  for (let index = last; index >= 0; index -= 1) outline.push(right[index]!)
  outline.push(...capPoints(pts[0]!, -startDirection.x, -startDirection.y, halfWidths[0]!))
  return `${polylineD(outline, true)}`
}

/**
 * Emit a polyline as an SVG path. A single point becomes a zero-length
 * segment, which a round-capped stroke renders as a pen dab.
 * @param points - the polyline.
 * @param closed - append `Z`.
 * @returns the `d` string.
 */
export function polylineD(points: readonly Pt[], closed: boolean): string {
  const first = points[0]
  if (first === undefined) return ''
  if (points.length === 1) {
    return `M ${f(first.x)} ${f(first.y)} L ${f(first.x)} ${f(first.y)}`
  }
  let d = `M ${f(first.x)} ${f(first.y)}`
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index]!
    d += ` L ${f(point.x)} ${f(point.y)}`
  }
  return closed ? `${d} Z` : d
}

/**
 * Break each straight edge into short steps and push interior points off the
 * line by a seeded amount, the way a hand never draws a straight line.
 * Corners stay where they are so the shape is still recognisable.
 * @param points - the true polyline.
 * @param closed - whether the last edge returns to the first point.
 * @param rng - the element's seeded generator.
 * @returns the wobbled polyline.
 */
export function wobblePolyline(points: readonly Pt[], closed: boolean, rng: () => number): Pt[] {
  if (points.length < 2) return [...points]
  const out: Pt[] = []
  const edgeCount = closed ? points.length : points.length - 1
  for (let index = 0; index < edgeCount; index += 1) {
    const from = points[index]!
    const to = points[(index + 1) % points.length]!
    out.push(from)
    const length = distance(from, to)
    if (length < 1e-6) continue
    const steps = Math.floor(length / WOBBLE_STEP)
    const nx = -(to.y - from.y) / length
    const ny = (to.x - from.x) / length
    for (let step = 1; step <= steps; step += 1) {
      const t = step / (steps + 1)
      const shift = (rng() * 2 - 1) * WOBBLE_AMPLITUDE
      out.push({
        x: from.x + (to.x - from.x) * t + nx * shift,
        y: from.y + (to.y - from.y) * t + ny * shift,
      })
    }
  }
  if (!closed) out.push(points[points.length - 1]!)
  return out
}

/**
 * Push every point off its place by a seeded amount. For dense curves (an
 * ellipse) whose sampling already out-resolves the wobble step.
 * @param points - the true points.
 * @param rng - the element's seeded generator.
 * @param amplitude - maximum shift in each axis, in canvas units.
 * @returns the jittered points.
 */
export function jitterPoints(points: readonly Pt[], rng: () => number, amplitude: number): Pt[] {
  return points.map(point => ({
    x: point.x + (rng() * 2 - 1) * amplitude,
    y: point.y + (rng() * 2 - 1) * amplitude,
  }))
}

/** The centerline a shape element draws, plus whether it closes. */
export interface ShapeOutline {
  readonly points: readonly Pt[]
  readonly closed: boolean
}

/**
 * Turn a shape primitive into a centerline the stroke renderer can draw.
 * @param shape - the primitive.
 * @param x - left edge (or line start x).
 * @param y - top edge (or line start y).
 * @param w - width (or line offset x).
 * @param h - height (or line offset y).
 * @returns the centerline and whether the last edge closes back to the first point.
 */
export function shapeOutline(shape: DrawShapeKind, x: number, y: number, w: number, h: number): ShapeOutline {
  switch (shape) {
    case 'rect':
      return { points: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], closed: true }
    case 'triangle':
      return { points: [{ x: x + w / 2, y }, { x: x + w, y: y + h }, { x, y: y + h }], closed: true }
    case 'diamond':
      return {
        points: [{ x: x + w / 2, y }, { x: x + w, y: y + h / 2 }, { x: x + w / 2, y: y + h }, { x, y: y + h / 2 }],
        closed: true,
      }
    case 'ellipse': {
      const centerX = x + w / 2
      const centerY = y + h / 2
      const points: Pt[] = []
      for (let index = 0; index < ELLIPSE_POINTS; index += 1) {
        const angle = (index / ELLIPSE_POINTS) * Math.PI * 2
        points.push({ x: centerX + (w / 2) * Math.cos(angle), y: centerY + (h / 2) * Math.sin(angle) })
      }
      return { points, closed: true }
    }
    case 'line':
    case 'arrow':
      return { points: [{ x, y }, { x: x + w, y: y + h }], closed: false }
  }
}

/**
 * The filled triangle(s) that make a line an arrow.
 * @param element - an `arrow` shape element.
 * @returns one path per arrowhead, filled with the stroke color.
 */
export function arrowHeadPaths(element: DrawShapeElement): string[] {
  const length = Math.hypot(element.w, element.h)
  if (length === 0) return []
  const ux = element.w / length
  const uy = element.h / length
  const size = Math.max(MIN_ARROW_HEAD, element.width * 3.2)
  const halfWidth = size * 0.5
  const nx = -uy
  const ny = ux
  const head = (tipX: number, tipY: number, dirX: number, dirY: number): string => {
    const baseX = tipX - dirX * size
    const baseY = tipY - dirY * size
    return `M ${f(tipX)} ${f(tipY)} L ${f(baseX + nx * halfWidth)} ${f(baseY + ny * halfWidth)} L ${f(baseX - nx * halfWidth)} ${f(baseY - ny * halfWidth)} Z`
  }
  const heads = [head(element.x + element.w, element.y + element.h, ux, uy)]
  if (element.arrowStart) heads.push(head(element.x, element.y, -ux, -uy))
  return heads
}

/** One constant-width stroke the renderer paints. */
export interface InkStroke {
  readonly kind: 'stroke'
  readonly d: string
  readonly color: string
  readonly width: number
  readonly opacity: number
  readonly cap: 'round' | 'butt'
  readonly dasharray: string | undefined
}

/** One filled area the renderer paints: a stroke outline, a shape fill, or an arrowhead. */
export interface InkFill {
  readonly kind: 'fill'
  readonly d: string
  readonly color: string
  readonly opacity: number
}

/** One painted part of a drawing element, in paint order. */
export type InkPart = InkStroke | InkFill

/**
 * Dash lengths for one dash style, in canvas units.
 * Dots are a near-zero dash plus a round cap, which is how a pen draws them.
 * @param dash - the element's dash style.
 * @returns the `stroke-dasharray` value, or undefined for a solid line.
 */
export function dashArrayFor(dash: DrawDash): string | undefined {
  if (dash === 'dashed') return '8 6'
  if (dash === 'dotted') return '0.1 5'
  return undefined
}

/**
 * Split normalized commands into subpaths, remembering which ones close.
 *
 * A path can hold several subpaths, and only a closed one encloses an area worth
 * filling -- flattening the whole command list would lose that distinction.
 * @param commands - the normalized commands.
 * @returns one point list and closed flag per subpath.
 */
function splitSubpaths(commands: readonly DrawPathCommand[]): { points: readonly Pt[]; closed: boolean }[] {
  const subpaths: { points: readonly Pt[]; closed: boolean }[] = []
  let current: DrawPathCommand[] = []
  const flush = (): void => {
    if (current.length === 0) return
    const closed = current.some(command => command.cmd === 'Z')
    const points = flattenPathCommands(current)[0]
    if (points !== undefined && points.length > 1) subpaths.push({ points, closed })
    current = []
  }
  for (const command of commands) {
    if (command.cmd === 'M' && current.length > 0) flush()
    current.push(command)
  }
  flush()
  return subpaths
}

/**
 * The filled areas a path element contributes, before its stroke.
 * @param commands - the element's normalized commands.
 * @param color - the resolved fill color.
 * @param opacity - the fill's opacity.
 * @returns one fill per closed subpath, in declaration order.
 */
function filledSubpathParts(commands: readonly DrawPathCommand[], color: string, opacity: number): InkPart[] {
  const parts: InkPart[] = []
  for (const subpath of splitSubpaths(commands)) {
    if (!subpath.closed) continue
    const d = polylineD(subpath.points, true)
    if (d.length > 0) parts.push({ kind: 'fill', d, color, opacity })
  }
  return parts
}

/**
 * Render one path element into paint parts.
 *
 * Stroke pens emit one centerline path (plus a second grain pass for a
 * pencil); outline pens emit one filled outline per subpath, which is how the
 * pen's character -- fountain taper, brush taper, calligraphy nib -- shows up.
 *
 * A `fill` on the element is painted before the stroke, so a closed path can be a
 * hill or lake rather than an empty outline; `fillOpacity` turns it into a wash.
 * Only closed subpaths fill; an open line has no interior to paint.
 * @param element - the path element.
 * @param rng - the element's seeded generator, used only by the pencil grain.
 * @returns the parts in paint order.
 */
export function renderPathElement(element: DrawPathElement, rng: () => number): readonly InkPart[] {
  const parsed = parseDrawPathData(element.d)
  if (!parsed.ok) return []
  const subpaths = flattenPathCommands(parsed.commands)
  if (subpaths.length === 0) return []
  const color = resolveDrawColor(element.color)
  const fills = element.fill === undefined
    ? []
    : filledSubpathParts(parsed.commands, resolveDrawColor(element.fill), element.fillOpacity ?? 1)
  const spec = penSpec(element.pen, element.width)
  if (spec.kind === 'stroke') {
    const d = subpaths
      .map(points => polylineD(points, false))
      .filter(part => part.length > 0)
      .join(' ')
    const parts: InkPart[] = d.length === 0
      ? []
      : [{ kind: 'stroke', d, color, width: spec.width, opacity: spec.opacity, cap: spec.cap, dasharray: undefined }]
    if (spec.grain) {
      const grain = subpaths
        .map(points => polylineD(jitterPoints(points, rng, 0.5), false))
        .filter(part => part.length > 0)
        .join(' ')
      if (grain.length > 0) {
        parts.push({ kind: 'stroke', d: grain, color, width: spec.width * 0.5, opacity: 0.3, cap: 'round', dasharray: undefined })
      }
    }
    return [...fills, ...parts]
  }
  const outlined = subpaths
    .map(points => outlineSubpath(points, spec.halfWidth))
    .filter(d => d.length > 0)
    .map(d => ({ kind: 'fill' as const, d, color, opacity: spec.opacity }))
  return [...fills, ...outlined]
}

/**
 * Render one shape element into paint parts: the fill first, then the outline
 * (wobbled when rough), then any arrowheads.
 * @param element - the shape element.
 * @param rng - the element's seeded generator.
 * @returns the parts in paint order.
 */
export function renderShapeElement(element: DrawShapeElement, rng: () => number): readonly InkPart[] {
  const outline = shapeOutline(element.shape, element.x, element.y, element.w, element.h)
  const points = element.rough
    ? element.shape === 'ellipse'
      ? jitterPoints(outline.points, rng, 0.9)
      : wobblePolyline(outline.points, outline.closed, rng)
    : outline.points
  const color = resolveDrawColor(element.color)
  const parts: InkPart[] = []
  if (element.fill !== undefined && outline.closed) {
    parts.push({
      kind: 'fill',
      d: polylineD(points, true),
      color: resolveDrawColor(element.fill),
      opacity: element.fillOpacity ?? 0.25,
    })
  }
  parts.push({
    kind: 'stroke',
    d: polylineD(points, outline.closed),
    color,
    width: element.width,
    opacity: 0.95,
    cap: 'round',
    dasharray: dashArrayFor(element.dash),
  })
  if (element.shape === 'arrow') {
    for (const d of arrowHeadPaths(element)) {
      parts.push({ kind: 'fill', d, color, opacity: 0.95 })
    }
  }
  return parts
}

/**
 * One strip of washi tape: a translucent band with slightly torn ends.
 * @param element - the tape element.
 * @param rng - the element's seeded generator.
 * @returns a closed path, rotated by the caller.
 */
export function tapePath(element: DrawTapeElement, rng: () => number): string {
  const { x, y, w, h } = element
  const jag = (): number => (rng() * 2 - 1) * 2.5
  const points: Pt[] = [
    { x: x + jag(), y: y - 1 },
    { x: x + jag(), y: y + h + 1 },
    { x: x + w * 0.3, y: y + h + jag() * 0.5 },
    { x: x + w * 0.7, y: y + h + jag() * 0.5 },
    { x: x + w + jag(), y: y + h + 1 },
    { x: x + w + jag(), y: y - 1 },
    { x: x + w * 0.7, y: y + jag() * 0.5 },
    { x: x + w * 0.3, y: y + jag() * 0.5 },
  ]
  return polylineD(points, true)
}

/**
 * Render one pixel-art block as filled squares, grouped into one path per
 * color so a 16x16 picture costs a handful of DOM nodes rather than 256.
 * Row/column sizes come from the strings themselves, so ragged rows are fine
 * and only palette characters paint.
 * @param element - the pixels element.
 * @returns one fill per palette color that appears, in first-use order.
 */
export function pixelParts(element: DrawPixelElement): readonly InkPart[] {
  const { cell } = element
  const groups = new Map<string, string[]>()
  for (let rowIndex = 0; rowIndex < element.rows.length; rowIndex += 1) {
    const row = element.rows[rowIndex]!
    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      const color = element.palette[row.charAt(columnIndex)]
      if (color === undefined) continue
      const paint = resolveDrawColor(color)
      const px = element.x + columnIndex * cell
      const py = element.y + rowIndex * cell
      const rect = `M ${f(px)} ${f(py)} h ${f(cell)} v ${f(cell)} h -${f(cell)} Z`
      const rects = groups.get(paint)
      if (rects === undefined) groups.set(paint, [rect])
      else rects.push(rect)
    }
  }
  return [...groups.entries()].map(([color, rects]) => ({
    kind: 'fill' as const,
    d: rects.join(' '),
    color,
    opacity: 1,
  }))
}
