/**
 * The `draw` self-check: what a model cannot see about its own picture.
 *
 * A model authors a drawing as numbers and never sees the result, so the same
 * class of mistake repeats: the subject drifts off-centre, a shape hangs off the
 * canvas, the composition huddles in one corner, ten hues fight each other, a
 * caption lands on top of the mountains. None of that needs taste to detect --
 * it is geometry -- so it is detected here, deterministically, and reported in
 * the same breath as the card.
 *
 * The numbers come from a coarse occupancy sample of the display list, which is
 * cheap, font-free and identical on the Host and in the browser. The result is a
 * bounded list of facts plus at most a handful of warnings; an empty warning
 * list is the honest answer "nothing structural is wrong".
 */

import type { DrawBox } from './draw-render.ts'
import type { DrawDisplayList, DrawInk } from './draw-render.ts'
import type { Pt } from './draw-engine.ts'

/** Sample columns across the canvas, fine enough for a 3x3 grid and edge bands. */
const SAMPLE_COLS = 48

/** Sample rows across the canvas. */
const SAMPLE_ROWS = 30

/** Coverage below this reads as "too small to carry the frame". */
const THIN_COVERAGE = 0.06

/** Distinct hue families above this read as an uncontrolled palette. */
const BUSY_PALETTE = 7

/** An edge band with no ink at all reads as an unbalanced composition. */
const EDGE_BAND = 0.12

/**
 * Overflow below this, in canvas units, is hand-drawn wobble rather than a
 * mistake: the rough engine wanders about 1.35 units past the geometry it was
 * given, so a shape placed exactly against an edge always pokes out slightly.
 */
const CLIP_TOLERANCE = 2

/** Share of a text block another element may cover before it reads as text on ink. */
const TEXT_OVERLAP = 0.35

/** One element's share of the problems a drawing can have. */
export interface DrawElementFault {
  readonly index: number
  readonly type: string
  /** Human-readable reason this element was flagged. */
  readonly reason: string
}

/** The machine-checkable facts about one drawing. */
export interface DrawDiagnostics {
  readonly canvas: { readonly w: number; readonly h: number }
  readonly elements: number
  /** Element count per type, e.g. `{ path: 12, text: 2 }`. */
  readonly counts: Readonly<Record<string, number>>
  /** Union extent of all ink, or undefined for an inkless drawing. */
  readonly box: DrawBox | undefined
  /** Fraction of the canvas area the ink's bounding box spans. */
  readonly spread: number
  /** Fraction of sampled cells that carry ink. */
  readonly coverage: number
  /** 3x3 ink density, row-major from the top-left cell. */
  readonly grid: readonly number[]
  /** Ink weight centroid, as an offset from the canvas centre in -1..1. */
  readonly balance: { readonly dx: number; readonly dy: number }
  /** Distinct paint colors actually used. */
  readonly colors: readonly string[]
  /**
   * Coarse hue families those colors fall into, so a lightness ramp reads as one
   * family instead of a dozen "colors".
   */
  readonly hueFamilies: readonly string[]
  /** Elements with ink that leaves the canvas. */
  readonly clipped: readonly DrawElementFault[]
  /** Elements whose ink is entirely off-canvas. */
  readonly outside: readonly DrawElementFault[]
  /** Canvas sides (left/right/top/bottom) whose outer band carries no ink. */
  readonly emptyEdges: readonly string[]
  readonly warnings: readonly string[]
}

/** Whether a point is inside a polygon, by even-odd ray casting. */
function pointInPolygon(x: number, y: number, points: readonly Pt[]): boolean {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const a = points[i]!
    const b = points[j]!
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

/** Squared distance from a point to a segment. */
function segmentDistanceSq(x: number, y: number, a: Pt, b: Pt): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSq = dx * dx + dy * dy
  let t = lengthSq === 0 ? 0 : ((x - a.x) * dx + (y - a.y) * dy) / lengthSq
  t = Math.max(0, Math.min(1, t))
  const px = a.x + t * dx
  const py = a.y + t * dy
  return (x - px) ** 2 + (y - py) ** 2
}

/** Whether a sample point near an ink piece should count as covered by it. */
function inkCoversPoint(ink: DrawInk, x: number, y: number, slack: number): boolean {
  if (ink.kind === 'block') {
    return x >= ink.x - slack && x <= ink.x + ink.w + slack && y >= ink.y - slack && y <= ink.y + ink.h + slack
  }
  if (ink.kind === 'polygon') {
    return pointInPolygon(x, y, ink.points)
  }
  // A thin centerline rarely passes exactly through a sample point, so a
  // stroke counts whenever the sample sits within half a cell of it.
  const reach = Math.max(ink.width / 2, slack)
  const reachSq = reach * reach
  for (let i = 1; i < ink.points.length; i += 1) {
    if (segmentDistanceSq(x, y, ink.points[i - 1]!, ink.points[i]!) <= reachSq) return true
  }
  return false
}

/** Round to three decimals, so a report reads cleanly and stays stable. */
function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

/**
 * The coarse hue family a paint color belongs to.
 *
 * The check is about palette discipline, not about how many shades a gradient
 * has: nine blues that step from deep to pale are one family, and nine unrelated
 * hues are nine families. Near-neutral colors (paper, ink, white, grey) share one
 * family, because they are the ones a palette is built *around*.
 * @param color - a resolved `#rgb`/`#rrggbb` paint value.
 * @returns a bucket name, or 'neutral' for greys and near-greys.
 */
function hueFamily(color: string): string {
  const hex = color.trim().replace(/^#/u, '')
  const full = hex.length === 3
    ? hex.split('').map(character => character + character).join('')
    : hex
  if (!/^[0-9a-f]{6}$/iu.test(full)) return 'neutral'
  const r = Number.parseInt(full.slice(0, 2), 16)
  const g = Number.parseInt(full.slice(2, 4), 16)
  const b = Number.parseInt(full.slice(4, 6), 16)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  const saturation = delta / (255 - Math.abs(max + min - 255) || 1)
  if (saturation < 0.12) return 'neutral'
  const raw = max === r
    ? ((g - b) / delta + 6) % 6
    : max === g
      ? (b - r) / delta + 2
      : (r - g) / delta + 4
  const hue = raw * 60
  return `hue-${Math.round(hue / 30) % 12}`
}

/** Union of two boxes. */
function unionBox(a: DrawBox | undefined, b: DrawBox | undefined): DrawBox | undefined {
  if (a === undefined) return b
  if (b === undefined) return a
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}

/**
 * Inspect a display list and report what a model cannot see.
 * @param list - the drawing's display list.
 * @returns machine-checkable facts plus the warnings they imply.
 */
export function analyzeDraw(list: DrawDisplayList): DrawDiagnostics {
  const { width, height } = list
  const cellW = width / SAMPLE_COLS
  const cellH = height / SAMPLE_ROWS
  const slack = Math.min(cellW, cellH) / 2

  const coverage = new Array<boolean>(SAMPLE_COLS * SAMPLE_ROWS).fill(false)
  let covered = 0
  let weightX = 0
  let weightY = 0
  let weight = 0
  for (let row = 0; row < SAMPLE_ROWS; row += 1) {
    for (let column = 0; column < SAMPLE_COLS; column += 1) {
      const x = (column + 0.5) * cellW
      const y = (row + 0.5) * cellH
      if (list.paints.some(ink => inkCoversPoint(ink, x, y, slack))) {
        coverage[row * SAMPLE_COLS + column] = true
        covered += 1
        weightX += x
        weightY += y
        weight += 1
      }
    }
  }

  const grid = new Array<number>(9).fill(0)
  const gridCells = new Array<number>(9).fill(0)
  for (let row = 0; row < SAMPLE_ROWS; row += 1) {
    for (let column = 0; column < SAMPLE_COLS; column += 1) {
      const gx = Math.min(2, Math.floor((column / SAMPLE_COLS) * 3))
      const gy = Math.min(2, Math.floor((row / SAMPLE_ROWS) * 3))
      const slot = gy * 3 + gx
      gridCells[slot] = (gridCells[slot] ?? 0) + 1
      if (coverage[row * SAMPLE_COLS + column] === true) grid[slot] = (grid[slot] ?? 0) + 1
    }
  }
  for (let slot = 0; slot < 9; slot += 1) grid[slot] = round((grid[slot] ?? 0) / (gridCells[slot] ?? 1))

  // Edge bands, so "everything is crammed in the middle" is reportable.
  const bandCols = Math.max(1, Math.round(SAMPLE_COLS * EDGE_BAND))
  const bandRows = Math.max(1, Math.round(SAMPLE_ROWS * EDGE_BAND))
  const touched = { left: false, right: false, top: false, bottom: false }
  for (let row = 0; row < SAMPLE_ROWS; row += 1) {
    for (let column = 0; column < SAMPLE_COLS; column += 1) {
      if (coverage[row * SAMPLE_COLS + column] !== true) continue
      if (column < bandCols) touched.left = true
      if (column >= SAMPLE_COLS - bandCols) touched.right = true
      if (row < bandRows) touched.top = true
      if (row >= SAMPLE_ROWS - bandRows) touched.bottom = true
    }
  }
  const emptyEdges = (['left', 'right', 'top', 'bottom'] as const).filter(side => !touched[side])

  const counts: Record<string, number> = {}
  let box: DrawBox | undefined
  const colors = new Set<string>()
  const clipped: DrawElementFault[] = []
  const outside: DrawElementFault[] = []
  for (const group of list.groups) {
    counts[group.type] = (counts[group.type] ?? 0) + 1
    box = unionBox(box, group.box)
    for (const ink of group.inks) colors.add(ink.color)
    const groupBox = group.box
    if (groupBox === undefined) continue
    const left = groupBox.x
    const top = groupBox.y
    const right = groupBox.x + groupBox.w
    const bottom = groupBox.y + groupBox.h
    if (right <= 0 || bottom <= 0 || left >= width || top >= height) {
      outside.push({ index: group.index, type: group.type, reason: 'entirely outside the canvas' })
    } else if (left < -CLIP_TOLERANCE || top < -CLIP_TOLERANCE || right > width + CLIP_TOLERANCE || bottom > height + CLIP_TOLERANCE) {
      clipped.push({
        index: group.index,
        type: group.type,
        reason: `crosses the canvas edge (${round(left)}, ${round(top)}) to (${round(right)}, ${round(bottom)})`,
      })
    }
  }

  const spread = box === undefined ? 0 : round((box.w * box.h) / (width * height))
  const inkCoverage = round(covered / (SAMPLE_COLS * SAMPLE_ROWS))
  const balance = weight === 0
    ? { dx: 0, dy: 0 }
    : {
      dx: round(((weightX / weight) / width) * 2 - 1),
      dy: round(((weightY / weight) / height) * 2 - 1),
    }

  const warnings: string[] = []
  if (outside.length > 0) {
    warnings.push(`${outside.length} element(s) draw nothing on the canvas: ${describeFaults(outside)}. Move them inside ${width}x${height}.`)
  }
  if (clipped.length > 0) {
    warnings.push(`${clipped.length} element(s) run off the canvas and are cut: ${describeFaults(clipped)}. Either move them inside or make the cut deliberate.`)
  }
  if (box === undefined) {
    warnings.push('no ink at all: every element is empty or off-canvas.')
  } else {
    if (inkCoverage < THIN_COVERAGE) {
      warnings.push(`ink covers only ${Math.round(inkCoverage * 100)}% of the canvas, so the subject reads as small; scale it up or add a second layer.`)
    }
    if (emptyEdges.length > 0) {
      warnings.push(`the ${emptyEdges.join('/')} edge band carries no ink, so the composition leans away from it.`)
    }
    if (Math.abs(balance.dx) > 0.28 || Math.abs(balance.dy) > 0.28) {
      const directionX = balance.dx > 0.28 ? 'right' : balance.dx < -0.28 ? 'left' : ''
      const directionY = balance.dy > 0.28 ? 'down' : balance.dy < -0.28 ? 'up' : ''
      warnings.push(`ink weight sits ${[directionY, directionX].filter(Boolean).join('-')} of centre (offset ${balance.dx}, ${balance.dy}); a deliberate off-centre subject is fine, a drift is not.`)
    }
  }
  const hueFamilies = [...new Set([...colors].map(hueFamily))]
  if (hueFamilies.length > BUSY_PALETTE) {
    warnings.push(`${hueFamilies.length} distinct hue families; 3-5 hue families with a couple of lightness steps each reads calmer.`)
  }
  const buriedText = textOnInk(list)
  if (buriedText.length > 0) {
    warnings.push(`text is buried under other ink: ${describeFaults(buriedText)}. Move the caption clear, or draw the paper behind it first.`)
  }

  return {
    canvas: { w: width, h: height },
    elements: list.groups.length,
    counts,
    box,
    spread,
    coverage: inkCoverage,
    grid,
    balance,
    colors: [...colors],
    hueFamilies,
    clipped,
    outside,
    emptyEdges,
    warnings,
  }
}

/** Render element faults as `#3 (path), #7 (text)` for a warning line. */
function describeFaults(faults: readonly DrawElementFault[]): string {
  const shown = faults.slice(0, 6).map(fault => `#${fault.index} (${fault.type})`)
  return faults.length > shown.length ? `${shown.join(', ')}, ...` : shown.join(', ')
}

/**
 * Text elements whose footprint is mostly covered by other ink.
 *
 * Paint order means whatever was drawn after the caption sits on top of it, and
 * a model cannot tell that from its own coordinates. The check is a box overlap
 * against later elements only, which is enough to catch the failure that
 * actually happens: a label over a mountain, or under a band of color.
 * @param list - the drawing's display list.
 * @returns one fault per buried text element.
 */
function textOnInk(list: DrawDisplayList): DrawElementFault[] {
  const faults: DrawElementFault[] = []
  for (const group of list.groups) {
    if (group.type !== 'text' || group.box === undefined) continue
    const box = group.box
    const area = box.w * box.h
    if (area <= 0) continue
    let covered = 0
    const culprits: number[] = []
    for (const other of list.groups) {
      // Paint order is the only order that exists: an element drawn later covers
      // the caption, an element drawn earlier is behind it and harmless.
      if (other.index <= group.index || other.type === 'text' || other.box === undefined) continue
      const otherBox = other.box
      const overlapW = Math.min(box.x + box.w, otherBox.x + otherBox.w) - Math.max(box.x, otherBox.x)
      const overlapH = Math.min(box.y + box.h, otherBox.y + otherBox.h) - Math.max(box.y, otherBox.y)
      if (overlapW <= 0 || overlapH <= 0) continue
      covered += overlapW * overlapH
      culprits.push(other.index)
    }
    if (covered / area > TEXT_OVERLAP) {
      faults.push({
        index: group.index,
        type: 'text',
        reason: `covered by #${culprits.slice(0, 4).join(', #')}`,
      })
    }
  }
  return faults
}

/**
 * Format the diagnostics as the short text a model reads beside the picture.
 *
 * It stays on one line plus one warning per line: the numbers answer "is it
 * plausible", the warnings answer "what should change", and the picture itself
 * answers everything else.
 * @param diagnostics - the analyzed drawing.
 * @returns model-facing text, without a trailing newline.
 */
export function formatDrawDiagnostics(diagnostics: DrawDiagnostics): string {
  const kinds = Object.entries(diagnostics.counts).map(([type, count]) => `${count} ${type}`).join(', ')
  const parts = [
    `canvas ${diagnostics.canvas.w}x${diagnostics.canvas.h}`,
    `${diagnostics.elements} element(s): ${kinds}`,
    `ink ${Math.round(diagnostics.coverage * 100)}% of canvas`,
    `spread ${Math.round(diagnostics.spread * 100)}%`,
    `colors ${diagnostics.colors.length} in ${diagnostics.hueFamilies.length} hue famil${diagnostics.hueFamilies.length === 1 ? 'y' : 'ies'}`,
  ]
  if (diagnostics.box !== undefined) {
    const box = diagnostics.box
    parts.push(`extent x ${Math.round(box.x)}..${Math.round(box.x + box.w)} y ${Math.round(box.y)}..${Math.round(box.y + box.h)}`)
  }
  const lines = [`<self-check>${parts.join(' | ')}`]
  if (diagnostics.warnings.length === 0) {
    lines.push('no structural problems found.')
  } else {
    for (const warning of diagnostics.warnings) lines.push(`- ${warning}`)
  }
  lines.push('</self-check>')
  return lines.join('\n')
}
