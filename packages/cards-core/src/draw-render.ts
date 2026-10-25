/**
 * The `draw` display list: one picture, described once.
 *
 * The browser paints a drawing by mapping the engine's paint parts straight to
 * SVG elements. The Host has no DOM, so it needs the same picture in plain
 * numbers before it can rasterize a preview. This module is that shared
 * description: it runs the identical engine with the identical per-element seed
 * and keeps only geometry -- points, widths, colors, boxes -- so the preview and
 * the card cannot disagree about where anything is.
 *
 * Two things are deliberately approximate, and both are only about letterforms:
 * text becomes per-character boxes (a preview cannot load a font, and a box is
 * an honest footprint), and dash patterns are carried for the SVG export rather
 * than resolved into the raster. Neither affects composition, which is what a
 * preview is for.
 *
 * Nothing here touches a DOM, a global, or the network: a display list is a pure
 * function of the payload and a theme.
 */

import { parseDrawPathData, resolveDrawColor } from './index.ts'
import type {
  DrawBlend,
  DrawElement,
  DrawPaper,
  DrawPayload,
  DrawTapeElement,
  DrawTextElement,
  DrawTextAnchor,
} from './index.ts'
import { flattenPathCommands, pixelParts, renderPathElement, renderShapeElement, rngFor, tapePath } from './draw-engine.ts'
import type { InkGradient, InkPart, Pt } from './draw-engine.ts'

/** The colors a preview paints theme ink and paper rules with. */
export interface DrawPreviewTheme {
  /** Paper color behind the drawing. */
  readonly surface: string
  /** What "theme ink" (a color the model left undefined) resolves to. */
  readonly ink: string
  /** Paper ruling color for dots/grid/lined paper. */
  readonly rule: string
}

/** Light theme, used when a caller has no host theme to hand. */
export const DEFAULT_PREVIEW_THEME: DrawPreviewTheme = {
  surface: '#ffffff',
  ink: '#1f1f1f',
  rule: '#d8dbe2',
}

/** An axis-aligned box in canvas units. */
export interface DrawBox {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

/** A filled area. */
export interface DrawInkPolygon {
  readonly kind: 'polygon'
  readonly points: readonly Pt[]
  /** Flat paint value; for a gradient this is its first stop. */
  readonly color: string
  /** Resolved gradient, when the element asked for one instead of a flat fill. */
  readonly gradient?: InkGradient
  readonly opacity: number
  readonly blend: DrawBlend
  readonly blur: number
}

/** A constant-width line along a centerline. */
export interface DrawInkPolyline {
  readonly kind: 'polyline'
  readonly points: readonly Pt[]
  readonly color: string
  readonly width: number
  readonly opacity: number
  readonly closed: boolean
  readonly cap: 'round' | 'butt'
  readonly dasharray: string | undefined
  readonly blend: DrawBlend
  readonly blur: number
}

/** A filled rectangle: a pixel cell or one character's footprint. */
export interface DrawInkBlock {
  readonly kind: 'block'
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  readonly color: string
  readonly opacity: number
  readonly blend: DrawBlend
  readonly blur: number
}

/** One paintable piece of the drawing. */
export type DrawInk = DrawInkPolygon | DrawInkPolyline | DrawInkBlock

/** The ink one element contributed, plus its extent, for diagnostics. */
export interface DrawInkGroup {
  readonly index: number
  readonly type: DrawElement['type']
  readonly inks: readonly DrawInk[]
  /** Union extent of the element's ink, or undefined when it drew nothing. */
  readonly box: DrawBox | undefined
}

/** A complete, renderer-neutral description of a drawing. */
export interface DrawDisplayList {
  readonly width: number
  readonly height: number
  readonly paper: DrawPaper
  readonly background: string
  readonly theme: DrawPreviewTheme
  readonly groups: readonly DrawInkGroup[]
  /** Every ink in paint order: element order, then each element's own order. */
  readonly paints: readonly DrawInk[]
}

/** Characters at or above this code point are typeset full width (CJK and friends). */
const FULL_WIDTH_FROM = 0x2e80

/** Ink width of a character, in canvas units, used to place text footprints. */
function charAdvance(codePoint: number, size: number): number {
  if (codePoint === 0x20 || codePoint === 0x09) return size * 0.28
  if (codePoint >= FULL_WIDTH_FROM) return size
  return size * 0.54
}

/**
 * Resolve a paint value to a concrete color.
 *
 * `resolveDrawColor` answers with `var(--dsw-alias-text-primary, …)` for theme
 * ink, which only a styled DOM can resolve. An offscreen raster has no theme, so
 * the token becomes the theme's ink color here.
 * @param color - a validated color, or undefined for theme ink.
 * @param theme - the theme to resolve tokens against.
 * @returns a concrete color string.
 */
export function resolvePreviewPaint(color: string | undefined, theme: DrawPreviewTheme = DEFAULT_PREVIEW_THEME): string {
  const resolved = resolveDrawColor(color)
  return resolved.startsWith('var(') ? theme.ink : resolved
}

/** Whether an engine path closes back on itself. */
function isClosedPath(d: string): boolean {
  return /[Zz]/.test(d)
}

/**
 * Turn one engine path string back into point lists.
 *
 * The engine only ever emits what its own parser produced, so this is a
 * round-trip, not untrusted input: `parseDrawPathData` is reused rather than
 * re-implemented, and a string that does not parse simply contributes no ink.
 * @param d - the engine-emitted path.
 * @returns one point list per subpath.
 */
export function subpathsOf(d: string): readonly (readonly Pt[])[] {
  const parsed = parseDrawPathData(d)
  if (!parsed.ok) return []
  return flattenPathCommands(parsed.commands)
}

/** Convert one engine paint part into display-list ink. */
function inksOfPart(part: InkPart, theme: DrawPreviewTheme): DrawInk[] {
  const closed = isClosedPath(part.d)
  const inks: DrawInk[] = []
  for (const points of subpathsOf(part.d)) {
    if (points.length < 2) continue
    if (part.kind === 'fill') {
      inks.push({
        kind: 'polygon',
        points,
        color: part.color,
        ...part.gradient === undefined ? {} : { gradient: part.gradient },
        opacity: part.opacity,
        blend: part.blend,
        blur: part.blur,
      })
    } else {
      inks.push({
        kind: 'polyline',
        points,
        color: part.color,
        width: part.width,
        opacity: part.opacity,
        closed,
        cap: part.cap,
        dasharray: part.dasharray,
        blend: part.blend,
        blur: part.blur,
      })
    }
  }
  // A fill that is empty thanks to the theme token still needs its color fixed
  // up; a stroke's color may be the same token.
  return inks.map(ink => ({ ...ink, color: resolvePreviewPaint(ink.color, theme) }))
}

/**
 * One text element as per-character footprints.
 *
 * A baseline `y` and an anchor decide the block's left edge; the advance widths
 * are the same full-width/half-width rule the flowchart layout uses, so a line
 * of Chinese text occupies the width it visually occupies.
 * @param element - the text element.
 * @param theme - the theme to resolve theme ink against.
 * @returns one block per non-space character.
 */
export function textInkBlocks(element: DrawTextElement, theme: DrawPreviewTheme = DEFAULT_PREVIEW_THEME): DrawInkBlock[] {
  const color = resolvePreviewPaint(element.color, theme)
  const blocks: DrawInkBlock[] = []
  const lines = element.text.split('\n')
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]!
    const advances: number[] = []
    let width = 0
    for (const character of line) {
      const advance = charAdvance(character.codePointAt(0) ?? 0, element.size)
      advances.push(advance)
      width += advance
    }
    let cursor = element.x
    if (element.anchor === 'middle') cursor -= width / 2
    else if (element.anchor === 'end') cursor -= width

    const baseline = element.y + lineIndex * element.size * 1.35
    const top = baseline - element.size * 0.72
    const height = element.size * 0.78
    for (let i = 0; i < advances.length; i += 1) {
      const advance = advances[i]!
      const character = line.charAt(i)
      if (character !== ' ' && character !== '\t') {
        blocks.push({
          kind: 'block',
          x: cursor + advance * 0.06,
          y: top,
          w: Math.max(advance * 0.88, 1),
          h: height,
          color,
          opacity: element.bold ? 0.78 : 0.62,
          blend: 'normal',
          blur: 0,
        })
      }
      cursor += advance
    }
  }
  return blocks
}

/**
 * One strip of tape as a rotated polygon.
 * @param element - the tape element.
 * @param rng - the element's seeded generator.
 * @param theme - the theme to resolve the tape color against.
 * @returns the polygon path points, or an empty list for degenerate tape.
 */
export function tapePolygon(element: DrawTapeElement, rng: () => number, theme: DrawPreviewTheme = DEFAULT_PREVIEW_THEME): readonly Pt[] {
  const subpath = subpathsOf(tapePath(element, rng))[0]
  if (subpath === undefined) return []
  const centerX = element.x + element.w / 2
  const centerY = element.y + element.h / 2
  const radians = (element.angle * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return subpath.map((point) => {
    const dx = point.x - centerX
    const dy = point.y - centerY
    return { x: centerX + dx * cos - dy * sin, y: centerY + dx * sin + dy * cos }
  })
}

/**
 * Everything one element contributes, in paint order.
 * @param element - the element.
 * @param index - its position, which is also its wobble seed.
 * @param theme - the theme to resolve colors against.
 * @returns the ink pieces.
 */
export function elementInks(element: DrawElement, index: number, theme: DrawPreviewTheme = DEFAULT_PREVIEW_THEME): DrawInk[] {
  const rng = rngFor(index + 1)
  if (element.type === 'path') return renderPathElement(element, rng).flatMap(part => inksOfPart(part, theme))
  if (element.type === 'shape') return renderShapeElement(element, rng).flatMap(part => inksOfPart(part, theme))
  if (element.type === 'pixels') return pixelParts(element).flatMap(part => inksOfPart(part, theme))
  if (element.type === 'text') return textInkBlocks(element, theme)
  const points = tapePolygon(element, rng, theme)
  if (points.length < 3) return []
  return [{
    kind: 'polygon',
    points,
    color: resolvePreviewPaint(element.color ?? 'yellow', theme),
    opacity: 0.42,
    blend: 'normal',
    blur: 0,
  }]
}

/**
 * The union extent of a set of ink.
 * @param inks - the pieces to measure.
 * @returns their bounding box, or undefined when there is nothing to measure.
 */
export function boxOfInk(inks: readonly DrawInk[]): DrawBox | undefined {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  const extend = (x: number, y: number, pad: number): void => {
    minX = Math.min(minX, x - pad)
    minY = Math.min(minY, y - pad)
    maxX = Math.max(maxX, x + pad)
    maxY = Math.max(maxY, y + pad)
  }
  for (const ink of inks) {
    if (ink.kind === 'block') {
      extend(ink.x, ink.y, 0)
      extend(ink.x + ink.w, ink.y + ink.h, 0)
    } else if (ink.kind === 'polygon') {
      for (const point of ink.points) extend(point.x, point.y, 0)
    } else {
      const pad = ink.width / 2
      for (const point of ink.points) extend(point.x, point.y, pad)
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return undefined
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

/**
 * Build the renderer-neutral picture of a drawing.
 * @param draw - the parsed draw payload.
 * @param theme - the theme to resolve colors against.
 * @returns the display list, in canvas units.
 */
export function buildDrawDisplayList(
  draw: DrawPayload,
  theme: DrawPreviewTheme = DEFAULT_PREVIEW_THEME,
): DrawDisplayList {
  const groups: DrawInkGroup[] = []
  const paints: DrawInk[] = []
  for (let index = 0; index < draw.elements.length; index += 1) {
    const element = draw.elements[index]!
    const inks = elementInks(element, index, theme)
    for (const ink of inks) paints.push(ink)
    groups.push({ index, type: element.type, inks, box: boxOfInk(inks) })
  }
  return {
    width: draw.size.w,
    height: draw.size.h,
    paper: draw.paper,
    // A payload background wins over the card surface: it is the one color the
    // preview and the card must agree on, or a night scene previews as white.
    background: draw.background === undefined ? theme.surface : resolvePreviewPaint(draw.background, theme),
    theme,
    groups,
    paints,
  }
}

/** Round for compact emitted markup. */
function n(value: number): string {
  return String(Math.round(value * 100) / 100)
}

/** Escape text for XML content. */
function escapeXmlText(value: string): string {
  return value.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;')
}

/** Paper rule spacing, matching the browser's pattern tiles. */
const PAPER_TILE = 22

/** The paper ruling as one markup string (empty for plain paper). */
function paperMarkup(list: DrawDisplayList): string {
  if (list.paper === 'plain') return ''
  const rule = list.theme.rule
  if (list.paper === 'dots') {
    const dots: string[] = []
    for (let y = PAPER_TILE / 2; y < list.height; y += PAPER_TILE) {
      for (let x = PAPER_TILE / 2; x < list.width; x += PAPER_TILE) {
        dots.push(`<circle cx="${n(x)}" cy="${n(y)}" r="1.1" fill="${rule}" fill-opacity="0.7"/>`)
      }
    }
    return dots.join('')
  }
  const lines: string[] = []
  if (list.paper === 'grid') {
    for (let x = 0; x <= list.width; x += PAPER_TILE) {
      lines.push(`<path d="M ${n(x)} 0 L ${n(x)} ${n(list.height)}" stroke="${rule}" stroke-width="1" stroke-opacity="0.55"/>`)
    }
    for (let y = 0; y <= list.height; y += PAPER_TILE) {
      lines.push(`<path d="M 0 ${n(y)} L ${n(list.width)} ${n(y)}" stroke="${rule}" stroke-width="1" stroke-opacity="0.55"/>`)
    }
    return lines.join('')
  }
  for (let y = 13; y <= list.height; y += 26) {
    lines.push(`<path d="M 0 ${n(y)} L ${n(list.width)} ${n(y)}" stroke="${rule}" stroke-width="1" stroke-opacity="0.55"/>`)
  }
  return lines.join('')
}

/** The inline style an ink piece needs (blend, blur), or an empty string. */
function inkStyle(ink: DrawInk): string {
  const declarations: string[] = []
  if (ink.blend !== 'normal') declarations.push(`mix-blend-mode:${ink.blend}`)
  // A blur field is the visible spread; CSS blur() is a Gaussian stdDeviation.
  if (ink.blur > 0) declarations.push(`filter:blur(${n(ink.blur / 2)}px)`)
  return declarations.length === 0 ? '' : ` style="${declarations.join(';')}"`
}

/** One ink piece as standalone SVG markup. */
function inkMarkup(ink: DrawInk, gradientId?: string): string {
  const blend = inkStyle(ink)
  if (ink.kind === 'block') {
    return `<rect x="${n(ink.x)}" y="${n(ink.y)}" width="${n(ink.w)}" height="${n(ink.h)}" fill="${ink.color}" fill-opacity="${n(ink.opacity)}"${blend}/>`
  }
  const points = ink.points.map(point => `${n(point.x)},${n(point.y)}`).join(' ')
  if (ink.kind === 'polygon') {
    const paint = gradientId === undefined ? ink.color : `url(#${gradientId})`
    return `<polygon points="${points}" fill="${paint}" fill-opacity="${n(ink.opacity)}"${blend}/>`
  }
  const dash = ink.dasharray === undefined ? '' : ` stroke-dasharray="${ink.dasharray}"`
  return `<polyline points="${points}" fill="none" stroke="${ink.color}" stroke-opacity="${n(ink.opacity)}"`
    + ` stroke-width="${n(ink.width)}" stroke-linecap="${ink.cap}" stroke-linejoin="round"${dash}${blend}`
    + `${ink.closed ? ' data-closed="true"' : ''}/>`
}

/** One gradient as an SVG definition, in canvas coordinates. */
function gradientMarkup(id: string, gradient: InkGradient): string {
  const stops = gradient.stops
    .map(stop => `<stop offset="${n(stop.offset)}" stop-color="${stop.color}" stop-opacity="${n(stop.opacity)}"/>`)
    .join('')
  if (gradient.type === 'linear') {
    return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse"`
      + ` x1="${n(gradient.x1)}" y1="${n(gradient.y1)}" x2="${n(gradient.x2)}" y2="${n(gradient.y2)}">`
      + `${stops}</linearGradient>`
  }
  return `<radialGradient id="${id}" gradientUnits="userSpaceOnUse"`
    + ` cx="${n(gradient.cx)}" cy="${n(gradient.cy)}" r="${n(gradient.r)}">${stops}</radialGradient>`
}

/**
 * Serialize a display list as one standalone SVG document.
 *
 * This is the human-facing artifact (crisp at any zoom, opens in a browser); the
 * raster preview that goes back to the model is produced from the same list.
 * @param list - the display list.
 * @param title - optional accessible title.
 * @returns a complete `<svg>` element as text.
 */
export function drawSvgMarkup(list: DrawDisplayList, title?: string): string {
  const label = title === undefined ? '' : `<title>${escapeXmlText(title)}</title>`
  const ids = new Map<DrawInk, string>()
  const definitions: string[] = []
  for (const ink of list.paints) {
    if (ink.kind !== 'polygon' || ink.gradient === undefined) continue
    const id = `cdg${definitions.length}`
    ids.set(ink, id)
    definitions.push(gradientMarkup(id, ink.gradient))
  }
  const defs = definitions.length === 0 ? '' : `<defs>${definitions.join('')}</defs>`
  const body = list.paints.map(ink => inkMarkup(ink, ids.get(ink))).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${n(list.width)}" height="${n(list.height)}"`
    + ` viewBox="0 0 ${n(list.width)} ${n(list.height)}">${label}`
    + `<rect x="0" y="0" width="${n(list.width)}" height="${n(list.height)}" fill="${list.background}"/>`
    + `${paperMarkup(list)}${defs}${body}</svg>`
}
