/**
 * Deterministic geometry for the teaching-figure templates.
 *
 * The model never sees these numbers. Given semantic parameters, this module
 * computes every anchor, angle and label position, so the renderer cannot draw
 * a normal force at an arbitrary angle or detach an arrow from its body.
 *
 * Colours and type sizes are fixed tokens, not payload fields. A figure should
 * look the same in every card and survive a monochrome print.
 */

import type { AtomShellParams, ConnectedBodiesParams, InclineForceParams, OrbitalDiagramParams } from '@aisketch/cards-core'

/** Canvas size shared by both templates. */
export const FIGURE_WIDTH = 960
export const FIGURE_HEIGHT = 640

/** Plain scientific type; no handwriting. */
export const FIGURE_FONT_FAMILY = 'Inter, "Segoe UI", "Microsoft YaHei", system-ui, sans-serif'

/** One controlled palette; labels remain readable without colour. */
export const FIGURE_PALETTE = {
  ink: '#1f2937',
  muted: '#64748b',
  accent: '#2563eb',
  surface: '#ffffff',
  block: '#e2eaf5',
  wedge: '#f4f7fb',
} as const

/** A paint role used by a primitive. */
export type FigureColor = keyof typeof FIGURE_PALETTE

/** A point in canvas coordinates. */
export interface FigurePoint {
  readonly x: number
  readonly y: number
}

/** A straight line, optionally arrow-headed. */
export interface FigureLinePrimitive {
  readonly kind: 'line'
  readonly x1: number
  readonly y1: number
  readonly x2: number
  readonly y2: number
  readonly color: FigureColor
  readonly width: number
  readonly dash?: string
  readonly marker?: boolean
  /** Stable diagnostic role, e.g. `vector:N`; never a positioning input. */
  readonly role?: string
}

/** A filled or stroked polygon. */
export interface FigurePolygonPrimitive {
  readonly kind: 'polygon'
  readonly points: readonly FigurePoint[]
  readonly fill?: FigureColor
  readonly stroke?: FigureColor
  readonly width?: number
}

/** A circle, used for nuclei and electrons. */
export interface FigureCirclePrimitive {
  readonly kind: 'circle'
  readonly cx: number
  readonly cy: number
  readonly r: number
  readonly fill?: FigureColor
  readonly stroke?: FigureColor
  readonly width?: number
}

/** A path, used for the angle arc. */
export interface FigurePathPrimitive {
  readonly kind: 'path'
  readonly d: string
  readonly fill?: FigureColor
  readonly stroke?: FigureColor
  readonly width?: number
  readonly dash?: string
}

/** One text baseline. */
export interface FigureTextPrimitive {
  readonly kind: 'text'
  readonly x: number
  readonly y: number
  readonly text: string
  readonly size: number
  readonly color: FigureColor
  readonly anchor?: 'start' | 'middle' | 'end'
  readonly weight?: number
}

/** Everything the renderer draws. */
export type FigurePrimitive =
  | FigureLinePrimitive
  | FigurePolygonPrimitive
  | FigureCirclePrimitive
  | FigurePathPrimitive
  | FigureTextPrimitive

/** A complete figure layout. */
export interface FigureLayout {
  readonly width: number
  readonly height: number
  readonly background: FigureColor
  readonly primitives: readonly FigurePrimitive[]
  readonly ariaLabel: string
}

/** Round to one decimal for compact, stable SVG coordinates. */
function n(value: number): number {
  return Math.round(value * 10) / 10
}

/** Format a number for a label, keeping one decimal only when useful. */
function f(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

/** Add two points. */
function add(a: FigurePoint, b: FigurePoint): FigurePoint {
  return { x: a.x + b.x, y: a.y + b.y }
}

/** Scale a vector. */
function scale(a: FigurePoint, factor: number): FigurePoint {
  return { x: a.x * factor, y: a.y * factor }
}

/** Clamp a number. */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/** Pick a text anchor from a direction vector. */
function anchorFor(direction: FigurePoint): 'start' | 'middle' | 'end' {
  if (direction.x < -0.25) return 'end'
  if (direction.x > 0.25) return 'start'
  return 'middle'
}

/** Build one arrow line plus its label. */
function arrow(
  primitives: FigurePrimitive[],
  start: FigurePoint,
  end: FigurePoint,
  direction: FigurePoint,
  label: string,
  color: FigureColor,
  dashed = false,
): void {
  primitives.push({
    kind: 'line',
    x1: n(start.x),
    y1: n(start.y),
    x2: n(end.x),
    y2: n(end.y),
    color,
    width: 2.4,
    ...dashed ? { dash: '7 6' } : {},
    marker: true,
    role: `vector:${label}`,
  })
  const labelPoint = add(end, scale(direction, 18))
  primitives.push({
    kind: 'text',
    x: n(labelPoint.x),
    y: n(labelPoint.y - 6),
    text: label,
    size: 18,
    color: dashed ? 'muted' : 'ink',
    anchor: anchorFor(direction),
    weight: 600,
  })
}

/**
 * Build the inclined-plane force figure.
 *
 * Forces are anchored to the block/contact by construction. Arrow lengths are
 * readability-scaled, while the footer prints the physical magnitudes; the
 * authoritative information is direction + values, never a guessed pixel length.
 * @param params - validated incline parameters.
 * @returns a deterministic layout.
 */
export function buildInclineForceLayout(params: InclineForceParams): FigureLayout {
  const primitives: FigurePrimitive[] = []
  const rad = (params.angleDeg * Math.PI) / 180
  const sin = Math.sin(rad)
  const cos = Math.cos(rad)
  const baseY = 520
  const slopeLength = Math.min(560, 420 / sin)
  const t = 0.62
  const base: FigurePoint = { x: 480 - (cos * slopeLength) / 2, y: baseY }
  const dir: FigurePoint = { x: cos, y: -sin }
  const normal: FigurePoint = { x: -sin, y: -cos }
  const top = add(base, scale(dir, slopeLength))
  const contact = add(base, scale(dir, slopeLength * t))
  const blockWidth = 132
  const blockHeight = 76
  const center = add(contact, scale(normal, blockHeight / 2 + 4))
  const corner = (u: number, v: number): FigurePoint =>
    add(center, add(scale(dir, u * blockWidth / 2), scale(normal, v * blockHeight / 2)))
  const block = [corner(-1, 1), corner(1, 1), corner(1, -1), corner(-1, -1)]

  primitives.push(
    { kind: 'polygon', points: [base, { x: top.x, y: base.y }, top], fill: 'wedge', stroke: 'muted', width: 2 },
    { kind: 'line', x1: 80, y1: base.y + 10, x2: 880, y2: base.y + 10, color: 'muted', width: 1.4 },
    { kind: 'polygon', points: block, fill: 'block', stroke: 'ink', width: 2.2 },
  )

  const arcRadius = 62
  const arcStart = { x: n(base.x + arcRadius), y: n(base.y) }
  const arcEnd = {
    x: n(base.x + cos * arcRadius),
    y: n(base.y - sin * arcRadius),
  }
  primitives.push({
    kind: 'path',
    d: `M ${arcStart.x} ${arcStart.y} A ${arcRadius} ${arcRadius} 0 0 0 ${arcEnd.x} ${arcEnd.y}`,
    stroke: 'muted',
    width: 1.6,
  })
  const mid = add(base, {
    x: Math.cos(rad / 2) * (arcRadius + 28),
    y: -Math.sin(rad / 2) * (arcRadius + 28),
  })
  primitives.push({
    kind: 'text',
    x: n(mid.x),
    y: n(mid.y),
    text: `θ = ${f(params.angleDeg)}°`,
    size: 17,
    color: 'ink',
    anchor: 'start',
  })

  const gravity = params.massKg * params.gravity
  const normalForce = gravity * cos
  const frictionForce = params.frictionCoeff * normalForce
  const parallelForce = gravity * sin
  const perpendicularForce = gravity * cos
  const maxForce = Math.max(gravity, 1)
  const arrowScale = 130 / maxForce
  const forceLength = (force: number, min = 55): number => clamp(force * arrowScale, min, 130)
  const gravityMax = Math.max(60, 550 - center.y)
  const gravityLength = clamp(forceLength(gravity), 55, gravityMax)
  const normalLength = forceLength(normalForce)
  const frictionLength = frictionForce > 0.001 ? forceLength(frictionForce, 45) : 0

  if (params.showComponents) {
    arrow(primitives, center, add(center, scale(dir, -forceLength(parallelForce))), scale(dir, -1), 'G∥', 'muted', true)
    arrow(
      primitives,
      center,
      add(center, scale(normal, -forceLength(perpendicularForce))),
      scale(normal, -1),
      'G⊥',
      'muted',
      true,
    )
  }

  arrow(primitives, center, add(center, { x: 0, y: gravityLength }), { x: 0, y: 1 }, 'G', 'ink')
  arrow(primitives, center, add(center, scale(normal, normalLength)), normal, 'N', 'ink')
  if (frictionLength > 0) {
    arrow(primitives, center, add(center, scale(dir, frictionLength)), dir, 'f', 'ink')
  }

  primitives.push(
    { kind: 'circle', cx: n(center.x), cy: n(center.y), r: 2.2, fill: 'ink' },
    { kind: 'text', x: n(center.x), y: n(center.y + 6), text: 'm', size: 16, color: 'ink', anchor: 'middle', weight: 600 },
  )

  const semanticLine = `m = ${f(params.massKg)} kg   ·   θ = ${f(params.angleDeg)}°   ·   μ = ${params.frictionCoeff.toFixed(2)}   ·   g = ${f(params.gravity)} m/s²`
  primitives.push({
    kind: 'text',
    x: 80,
    y: params.showValues ? 602 : 616,
    text: semanticLine,
    size: 14,
    color: 'muted',
    anchor: 'start',
  })
  if (params.showValues) {
    const forceParts = [`G = ${gravity.toFixed(1)} N`, `N = ${normalForce.toFixed(1)} N`]
    if (frictionForce > 0.001) forceParts.push(`f = ${frictionForce.toFixed(1)} N`)
    primitives.push({
      kind: 'text',
      x: 80,
      y: 626,
      text: forceParts.join('   ·   '),
      size: 14,
      color: 'muted',
      anchor: 'start',
    })
  }

  return {
    width: FIGURE_WIDTH,
    height: FIGURE_HEIGHT,
    background: 'surface',
    primitives,
    ariaLabel: `斜面上的物块受力图：倾角 ${f(params.angleDeg)} 度，质量 ${f(params.massKg)} 千克，摩擦系数 ${params.frictionCoeff.toFixed(2)}`,
  }
}

/**
 * Build the table-pulley connected-body figure.
 *
 * A block on a rough table is tied over a fixed pulley to a hanging block. The
 * rope and pulley are decorative geometry; the force arrows are anchored by
 * construction, and the footer reports weights/normal/max friction rather than
 * inventing a tension value without the problem's stated dynamics.
 * @param params - validated connected-body parameters.
 * @returns a deterministic layout.
 */
export function buildConnectedBodiesLayout(params: ConnectedBodiesParams): FigureLayout {
  const primitives: FigurePrimitive[] = []
  const tableY = 430
  const tableStart = 80
  const tableEnd = 760
  const pulley = { x: 720, y: 395, r: 34 }
  const block = { x1: 230, y1: 360, x2: 370, y2: 430 }
  const hanging = { x1: 712, y1: 465, x2: 796, y2: 535 }
  const blockCenter = { x: (block.x1 + block.x2) / 2, y: (block.y1 + block.y2) / 2 }
  const hangingCenter = { x: (hanging.x1 + hanging.x2) / 2, y: (hanging.y1 + hanging.y2) / 2 }

  primitives.push(
    { kind: 'line', x1: tableStart, y1: tableY, x2: tableEnd, y2: tableY, color: 'muted', width: 3 },
    {
      kind: 'polygon',
      points: [{ x: 704, y: tableY }, { x: 736, y: tableY }, { x: 730, y: 412 }, { x: 710, y: 412 }],
      fill: 'wedge',
      stroke: 'muted',
      width: 1.8,
    },
    { kind: 'circle', cx: pulley.x, cy: pulley.y, r: pulley.r, fill: 'surface', stroke: 'muted', width: 2 },
    { kind: 'circle', cx: pulley.x, cy: pulley.y, r: 3.5, fill: 'ink' },
  )
  primitives.push({
    kind: 'path',
    d: `M ${block.x2} ${pulley.y} L ${pulley.x - pulley.r} ${pulley.y} A ${pulley.r} ${pulley.r} 0 0 0 ${pulley.x + pulley.r} ${pulley.y} L ${hangingCenter.x} ${hanging.y1}`,
    stroke: 'ink',
    width: 2.2,
  })
  primitives.push(
    {
      kind: 'polygon',
      points: [{ x: block.x1, y: block.y1 }, { x: block.x2, y: block.y1 }, { x: block.x2, y: block.y2 }, { x: block.x1, y: block.y2 }],
      fill: 'block',
      stroke: 'ink',
      width: 2.2,
    },
    {
      kind: 'polygon',
      points: [{ x: hanging.x1, y: hanging.y1 }, { x: hanging.x2, y: hanging.y1 }, { x: hanging.x2, y: hanging.y2 }, { x: hanging.x1, y: hanging.y2 }],
      fill: 'block',
      stroke: 'ink',
      width: 2.2,
    },
  )

  const weightSurface = params.surfaceMassKg * params.gravity
  const weightHanging = params.hangingMassKg * params.gravity
  const normal = weightSurface
  const frictionMax = params.frictionCoeff * normal
  const maxWeight = Math.max(weightSurface, weightHanging, 1)
  const scale = 110 / maxWeight
  const length = (force: number, min = 55): number => clamp(force * scale, min, 110)

  arrow(primitives, { x: blockCenter.x, y: block.y2 }, add({ x: blockCenter.x, y: block.y2 }, { x: 0, y: length(weightSurface) }), { x: 0, y: 1 }, 'G₁', 'ink')
  arrow(primitives, { x: blockCenter.x, y: block.y1 }, add({ x: blockCenter.x, y: block.y1 }, { x: 0, y: -length(normal) }), { x: 0, y: -1 }, 'N', 'ink')
  arrow(primitives, { x: block.x2, y: blockCenter.y }, add({ x: block.x2, y: blockCenter.y }, { x: 100, y: 0 }), { x: 1, y: 0 }, 'T', 'ink')
  if (frictionMax > 0.001) {
    arrow(primitives, { x: block.x1, y: blockCenter.y }, add({ x: block.x1, y: blockCenter.y }, { x: -length(frictionMax, 45), y: 0 }), { x: -1, y: 0 }, 'f', 'ink')
  }

  primitives.push(
    {
      kind: 'line',
      x1: hangingCenter.x,
      y1: hanging.y1,
      x2: hangingCenter.x,
      y2: hanging.y1 - 25,
      color: 'ink',
      width: 2.4,
      marker: true,
      role: 'vector:T-hanging',
    },
    {
      kind: 'text',
      x: hangingCenter.x + 18,
      y: 452,
      text: 'T',
      size: 18,
      color: 'ink',
      anchor: 'start',
      weight: 600,
    },
  )
  arrow(primitives, { x: hangingCenter.x, y: hanging.y2 }, add({ x: hangingCenter.x, y: hanging.y2 }, { x: 0, y: 40 }), { x: 0, y: 1 }, 'G₂', 'ink')

  primitives.push(
    { kind: 'text', x: blockCenter.x, y: blockCenter.y + 6, text: 'm₁', size: 16, color: 'ink', anchor: 'middle', weight: 600 },
    { kind: 'text', x: hangingCenter.x, y: hangingCenter.y + 6, text: 'm₂', size: 16, color: 'ink', anchor: 'middle', weight: 600 },
  )

  const semanticLine = `m₁ = ${f(params.surfaceMassKg)} kg   ·   m₂ = ${f(params.hangingMassKg)} kg   ·   μ = ${params.frictionCoeff.toFixed(2)}   ·   g = ${f(params.gravity)} m/s²`
  primitives.push({ kind: 'text', x: 80, y: params.showValues ? 602 : 616, text: semanticLine, size: 14, color: 'muted', anchor: 'start' })
  if (params.showValues) {
    const parts = [`G₁ = ${weightSurface.toFixed(1)} N`, `N = ${normal.toFixed(1)} N`, `G₂ = ${weightHanging.toFixed(1)} N`]
    if (frictionMax > 0.001) parts.push(`f_max = ${frictionMax.toFixed(1)} N`)
    primitives.push({ kind: 'text', x: 80, y: 626, text: parts.join('   ·   '), size: 14, color: 'muted', anchor: 'start' })
  }

  return {
    width: FIGURE_WIDTH,
    height: FIGURE_HEIGHT,
    background: 'surface',
    primitives,
    ariaLabel: `桌面上质量 ${f(params.surfaceMassKg)} 千克的物块经定滑轮连接悬挂质量 ${f(params.hangingMassKg)} 千克的物块，摩擦系数 ${params.frictionCoeff.toFixed(2)}`,
  }
}

/** Superscript digits for an electron configuration. */
const SUPERSCRIPT: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
  '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
}

/** Format a number with Unicode superscript digits. */
function superscript(value: string): string {
  return [...value].map(character => SUPERSCRIPT[character] ?? character).join('')
}

/** Number of orbitals in one subshell. */
function orbitalCount(subshell: string): number {
  const kind = subshell.at(-1)
  if (kind === 's') return 1
  if (kind === 'p') return 3
  if (kind === 'd') return 5
  return 7
}

/** Draw one electron arrow inside an orbital box. */
function electronArrow(primitives: FigurePrimitive[], x: number, top: number, bottom: number, down: boolean): void {
  const start = down ? top : bottom
  const end = down ? bottom : top
  primitives.push({ kind: 'line', x1: x, y1: start, x2: x, y2: end, color: 'accent', width: 1.8 })
  primitives.push({
    kind: 'polygon',
    points: down
      ? [{ x, y: end + 2 }, { x: x - 3.3, y: end - 5 }, { x: x + 3.3, y: end - 5 }]
      : [{ x, y: end - 2 }, { x: x - 3.3, y: end + 5 }, { x: x + 3.3, y: end + 5 }],
    fill: 'accent',
  })
}

/**
 * Build a 2D electron-configuration + orbital-box diagram.
 *
 * The symbol determines the configuration from a reference table; the model
 * never supplies orbital counts or arrow positions. Each box is one orbital,
 * with Hund filling and paired spins drawn deterministically.
 * @param params - validated orbital diagram parameters.
 * @returns a deterministic layout.
 */
export function buildOrbitalDiagramLayout(params: OrbitalDiagramParams): FigureLayout {
  const primitives: FigurePrimitive[] = []
  const rows = new Map<number, { subshell: string; electrons: number }[]>()
  for (const item of params.configuration) {
    const match = /^(\d)([spdf])$/u.exec(item.subshell)
    if (match === null) continue
    const n = Number(match[1])
    const group = rows.get(n) ?? []
    group.push(item)
    rows.set(n, group)
  }
  const sortedRows = [...rows.entries()].sort((a, b) => a[0] - b[0])
  let y = 250
  for (const [, subshells] of sortedRows) {
    let x = 90
    const order = 'spdf'
    const ordered = [...subshells].sort((a, b) => order.indexOf(a.subshell.at(-1) ?? '') - order.indexOf(b.subshell.at(-1) ?? ''))
    for (const subshell of ordered) {
      const count = orbitalCount(subshell.subshell)
      primitives.push({ kind: 'text', x, y: y - 12, text: subshell.subshell, size: 17, color: 'ink', anchor: 'start', weight: 600 })
      for (let orbital = 0; orbital < count; orbital += 1) {
        const bx = x + orbital * 52
        primitives.push({ kind: 'polygon', points: [{ x: bx, y }, { x: bx + 44, y }, { x: bx + 44, y: y + 34 }, { x: bx, y: y + 34 }], stroke: 'muted', width: 1.5 })
        const upCount = Math.min(subshell.electrons, count)
        const downCount = Math.max(0, subshell.electrons - count)
        if (orbital < upCount || orbital < downCount) {
          const paired = orbital < downCount
          const cx = bx + 22
          electronArrow(primitives, paired ? cx - 8 : cx, y + 5, y + 29, false)
          if (paired) electronArrow(primitives, cx + 8, y + 5, y + 29, true)
        }
      }
      x += count * 52 + 26
    }
    y += 100
  }

  const configText = params.configuration
    .map(item => `${item.subshell}${superscript(String(item.electrons))}`)
    .join(' ')
  const electrons = params.configuration.reduce((sum, item) => sum + item.electrons, 0)
  const orbitals = params.configuration.reduce((sum, item) => sum + orbitalCount(item.subshell), 0)

  primitives.push(
    { kind: 'text', x: 80, y: 92, text: params.symbol, size: 42, color: 'ink', anchor: 'start', weight: 700 },
    { kind: 'text', x: 80, y: 120, text: `Z = ${params.atomicNumber}`, size: 16, color: 'muted', anchor: 'start' },
    { kind: 'text', x: 80, y: 146, text: '电子排布', size: 14, color: 'muted', anchor: 'start' },
    { kind: 'text', x: 80, y: 170, text: configText, size: 18, color: 'ink', anchor: 'start' },
    { kind: 'text', x: 80, y: 602, text: `${params.symbol} · Z = ${params.atomicNumber} · ${orbitals} 个轨道 · ${electrons} 个电子`, size: 14, color: 'muted', anchor: 'start' },
    { kind: 'text', x: 80, y: 626, text: '每个框为一个轨道，↑↓ 表示自旋相反；按洪特规则先单占后成对。', size: 14, color: 'muted', anchor: 'start' },
  )

  return {
    width: FIGURE_WIDTH,
    height: FIGURE_HEIGHT,
    background: 'surface',
    primitives,
    ariaLabel: `${params.symbol} 原子的电子排布与轨道图，原子序数 ${params.atomicNumber}，${configText}`,
  }
}

/** Shell display names. */
const SHELL_NAMES = ['K', 'L', 'M', 'N', 'O', 'P', 'Q'] as const

/**
 * Build the neutral-atom shell figure.
 *
 * Every electron position comes from its shell index and count. The symbol
 * determines Z and the shell counts from the reference table, so the model
 * cannot draw an atom with the wrong electron total.
 * @param params - validated atom parameters.
 * @returns a deterministic layout.
 */
export function buildAtomShellLayout(params: AtomShellParams): FigureLayout {
  const primitives: FigurePrimitive[] = []
  const cx = 370
  const cy = 330
  const baseRadius = 70
  const gap = 45
  const shellCount = params.shells.length

  for (let index = 0; index < shellCount; index += 1) {
    const radius = baseRadius + gap * index
    const count = params.shells[index] ?? 0
    primitives.push({
      kind: 'circle',
      cx,
      cy,
      r: radius,
      stroke: 'muted',
      width: 1.6,
    })
    for (let electron = 0; electron < count; electron += 1) {
      const angle = -Math.PI / 2 + (2 * Math.PI * electron) / count
      primitives.push({
        kind: 'circle',
        cx: n(cx + Math.cos(angle) * radius),
        cy: n(cy + Math.sin(angle) * radius),
        r: 7,
        fill: 'accent',
        stroke: 'surface',
        width: 1.2,
      })
    }
  }

  primitives.push(
    { kind: 'circle', cx, cy, r: 30, fill: 'ink', stroke: 'ink', width: 2 },
    { kind: 'text', x: cx, y: cy + 6, text: `+${params.atomicNumber}`, size: 17, color: 'surface', anchor: 'middle', weight: 700 },
    { kind: 'line', x1: 670, y1: 138, x2: 870, y2: 138, color: 'muted', width: 1.2 },
    { kind: 'text', x: 700, y: 106, text: params.symbol, size: 36, color: 'ink', anchor: 'start', weight: 700 },
    { kind: 'text', x: 700, y: 130, text: `Z = ${params.atomicNumber}   ·   neutral atom`, size: 14, color: 'muted', anchor: 'start' },
  )

  for (let index = 0; index < shellCount; index += 1) {
    const y = 190 + index * 36
    const name = SHELL_NAMES[index] ?? String(index + 1)
    const count = params.shells[index] ?? 0
    primitives.push(
      { kind: 'circle', cx: 698, cy: y - 6, r: 4.5, fill: 'accent', stroke: 'surface', width: 1 },
      { kind: 'text', x: 722, y, text: `${name} shell`, size: 17, color: 'ink', anchor: 'start', weight: 500 },
    )
    if (params.showShellCounts) {
      primitives.push({ kind: 'text', x: 858, y, text: String(count), size: 17, color: 'muted', anchor: 'end', weight: 600 })
    }
  }

  primitives.push(
    { kind: 'text', x: 80, y: 610, text: `electron count = Z = ${params.atomicNumber}   ·   shells ${params.shells.join(',')}`, size: 14, color: 'muted', anchor: 'start' },
  )

  return {
    width: FIGURE_WIDTH,
    height: FIGURE_HEIGHT,
    background: 'surface',
    primitives,
    ariaLabel: `${params.symbol} 原子结构示意图，原子序数 ${params.atomicNumber}，电子层 ${params.shells.join('、')}`,
  }
}
