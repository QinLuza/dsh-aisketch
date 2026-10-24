import { describe, expect, it } from 'vitest'
import type { AtomShellParams, ConnectedBodiesParams, InclineForceParams, OrbitalDiagramParams } from '@aisketch/cards-core'
import { parseFigurePayload } from '@aisketch/cards-core'
import {
  FIGURE_HEIGHT,
  FIGURE_WIDTH,
  buildAtomShellLayout,
  buildConnectedBodiesLayout,
  buildInclineForceLayout,
  buildOrbitalDiagramLayout,
} from '../src/client/figure-geometry.ts'
import type { FigureCirclePrimitive, FigureLayout, FigureLinePrimitive, FigureTextPrimitive } from '../src/client/figure-geometry.ts'

/** Clamp an angle into [0, 360). */
function norm(angle: number): number {
  return (angle % 360 + 360) % 360
}

/** Find one semantic arrow line. */
function vectorOf(layout: FigureLayout, label: string): FigureLinePrimitive {
  const line = layout.primitives.find(
    (primitive): primitive is FigureLinePrimitive =>
      primitive.kind === 'line' && primitive.role === `vector:${label}`,
  )
  if (line === undefined) throw new Error(`vector ${label} missing`)
  return line
}

/** The screen angle of a line, in degrees. */
function angleOf(line: FigureLinePrimitive): number {
  return norm(Math.atan2(line.y2 - line.y1, line.x2 - line.x1) * 180 / Math.PI)
}

/** Parse one validated figure. */
function figure(payload: unknown) {
  const parsed = parseFigurePayload(payload)
  if (parsed === null) throw new Error('fixture did not parse')
  return parsed
}

const inclineParams: InclineForceParams = {
  angleDeg: 30,
  massKg: 2,
  frictionCoeff: 0.5,
  gravity: 9.8,
  showComponents: false,
  showValues: true,
}

const atomParams: AtomShellParams = {
  symbol: 'Na',
  atomicNumber: 11,
  shells: [2, 8, 1],
  showShellCounts: true,
}

describe('incline_force geometry', () => {
  it('derives gravity vertical, normal perpendicular and friction up-slope', () => {
    const layout = buildInclineForceLayout(inclineParams)
    expect(layout.width).toBe(FIGURE_WIDTH)
    expect(layout.height).toBe(FIGURE_HEIGHT)
    expect(Math.abs(angleOf(vectorOf(layout, 'G')) - 90)).toBeLessThan(0.2)
    expect(Math.abs(angleOf(vectorOf(layout, 'N')) - 240)).toBeLessThan(0.2)
    expect(Math.abs(angleOf(vectorOf(layout, 'f')) - 330)).toBeLessThan(0.2)
  })

  it('anchors all three forces at the same block centre', () => {
    const layout = buildInclineForceLayout(inclineParams)
    const gravity = vectorOf(layout, 'G')
    const normal = vectorOf(layout, 'N')
    const friction = vectorOf(layout, 'f')
    expect(normal.x1).toBe(gravity.x1)
    expect(normal.y1).toBe(gravity.y1)
    expect(friction.x1).toBe(gravity.x1)
    expect(friction.y1).toBe(gravity.y1)
  })

  it('adds dashed components only when asked, and hides zero friction', () => {
    const plain = buildInclineForceLayout(inclineParams)
    expect(plain.primitives.some(primitive => primitive.kind === 'line' && primitive.role === 'vector:G∥')).toBe(false)
    const components = buildInclineForceLayout({ ...inclineParams, showComponents: true, frictionCoeff: 0 })
    expect(components.primitives.some(primitive => primitive.kind === 'line' && primitive.role === 'vector:G∥')).toBe(true)
    expect(components.primitives.some(primitive => primitive.kind === 'line' && primitive.role === 'vector:G⊥')).toBe(true)
    expect(components.primitives.some(primitive => primitive.kind === 'line' && primitive.role === 'vector:f')).toBe(false)
  })

  it('prints the semantic parameters and computed force magnitudes', () => {
    const layout = buildInclineForceLayout(inclineParams)
    const text = layout.primitives
      .filter((primitive): primitive is Extract<typeof primitive, { kind: 'text' }> => primitive.kind === 'text')
      .map(primitive => primitive.text)
      .join('\n')
    expect(text).toContain('m = 2 kg')
    expect(text).toContain('θ = 30°')
    expect(text).toContain('μ = 0.50')
    expect(text).toContain('G = 19.6 N')
    expect(text).toContain('N = 17.0 N')
    expect(text).toContain('f = 8.5 N')
  })
})

describe('connected_bodies geometry', () => {
  const params: ConnectedBodiesParams = {
    surfaceMassKg: 2,
    hangingMassKg: 1.5,
    frictionCoeff: 0.3,
    gravity: 9.8,
    showValues: true,
  }

  it('derives table forces from the block and rope directions', () => {
    const layout = buildConnectedBodiesLayout(params)
    expect(Math.abs(angleOf(vectorOf(layout, 'G₁')) - 90)).toBeLessThan(0.2)
    expect(Math.abs(angleOf(vectorOf(layout, 'N')) - 270)).toBeLessThan(0.2)
    expect(Math.abs(angleOf(vectorOf(layout, 'T')) - 0)).toBeLessThan(0.2)
    expect(Math.abs(angleOf(vectorOf(layout, 'f')) - 180)).toBeLessThan(0.2)
    expect(Math.abs(angleOf(vectorOf(layout, 'T-hanging')) - 270)).toBeLessThan(0.2)
    expect(Math.abs(angleOf(vectorOf(layout, 'G₂')) - 90)).toBeLessThan(0.2)
  })

  it('anchors forces on the block faces in the correct directions', () => {
    const layout = buildConnectedBodiesLayout(params)
    const g = vectorOf(layout, 'G₁')
    const n = vectorOf(layout, 'N')
    const t = vectorOf(layout, 'T')
    const f = vectorOf(layout, 'f')
    expect(n.x1).toBe(g.x1)
    expect(t.y1).toBe(f.y1)
    expect(g.y1).toBeGreaterThan(n.y1)
    expect(f.x1).toBeLessThan(t.x1)
  })

  it('hides friction at μ=0 and prints the parameter/force footer', () => {
    const smooth = buildConnectedBodiesLayout({ ...params, frictionCoeff: 0 })
    expect(smooth.primitives.some(primitive => primitive.kind === 'line' && primitive.role === 'vector:f')).toBe(false)
    const layout = buildConnectedBodiesLayout(params)
    const texts = layout.primitives.filter((primitive): primitive is FigureTextPrimitive => primitive.kind === 'text').map(primitive => primitive.text)
    expect(texts).toContain('m₁ = 2 kg   ·   m₂ = 1.5 kg   ·   μ = 0.30   ·   g = 9.8 m/s²')
    expect(texts.some(text => text.includes('G₁ = 19.6 N'))).toBe(true)
    expect(texts.some(text => text.includes('f_max = 5.9 N'))).toBe(true)
  })
})

describe('orbital_diagram geometry', () => {
  const zn: OrbitalDiagramParams = {
    symbol: 'Zn',
    atomicNumber: 30,
    configuration: [
      { subshell: '1s', electrons: 2 }, { subshell: '2s', electrons: 2 }, { subshell: '2p', electrons: 6 },
      { subshell: '3s', electrons: 2 }, { subshell: '3p', electrons: 6 }, { subshell: '3d', electrons: 10 },
      { subshell: '4s', electrons: 2 },
    ],
  }

  it('draws one box per orbital and one arrow per electron', () => {
    const layout = buildOrbitalDiagramLayout(zn)
    const boxes = layout.primitives.filter(primitive => primitive.kind === 'polygon' && primitive.stroke === 'muted')
    expect(boxes).toHaveLength(15)
    const arrows = layout.primitives.filter(primitive => primitive.kind === 'line' && primitive.color === 'accent')
    expect(arrows).toHaveLength(30)
  })

  it('shows the configuration and the symbol header', () => {
    const layout = buildOrbitalDiagramLayout(zn)
    const texts = layout.primitives.filter((primitive): primitive is FigureTextPrimitive => primitive.kind === 'text').map(primitive => primitive.text)
    expect(texts).toContain('Zn')
    expect(texts.join(' ')).toContain('3d¹⁰')
    expect(texts.join(' ')).toContain('4s²')
    expect(texts.join(' ')).toContain('15 个轨道 · 30 个电子')
  })
})

describe('atom_shell geometry', () => {
  it('places exactly Z electrons on the reference shells', () => {
    const layout = buildAtomShellLayout(atomParams)
    const electrons = layout.primitives.filter(
      (primitive): primitive is FigureCirclePrimitive => primitive.kind === 'circle' && primitive.fill === 'accent' && primitive.r === 7,
    )
    expect(electrons).toHaveLength(11)
    const rings = layout.primitives.filter(
      (primitive): primitive is FigureCirclePrimitive => primitive.kind === 'circle' && primitive.fill === undefined && primitive.stroke === 'muted',
    )
    expect(rings).toHaveLength(3)
    expect(rings.map(ring => ring.r)).toEqual([70, 115, 160])
    for (const electron of electrons) {
      const distance = Math.hypot(electron.cx - 370, electron.cy - 330)
      expect([70, 115, 160].some(radius => Math.abs(distance - radius) < 0.2)).toBe(true)
    }
  })

  it('shows the nucleus charge, symbol and shell legend', () => {
    const layout = buildAtomShellLayout(atomParams)
    const texts = layout.primitives.filter(primitive => primitive.kind === 'text').map(primitive => primitive.text)
    expect(texts).toContain('+11')
    expect(texts).toContain('Na')
    expect(texts).toContain('Z = 11   ·   neutral atom')
    expect(texts).toContain('K shell')
    expect(texts).toContain('L shell')
    expect(texts).toContain('M shell')
    expect(layout.ariaLabel).toContain('Na')
  })

  it('can omit shell counts without changing the electron placement', () => {
    const noCounts = buildAtomShellLayout({ ...atomParams, showShellCounts: false })
    expect(noCounts.primitives.filter(primitive => primitive.kind === 'circle' && primitive.fill === 'accent' && primitive.r === 7)).toHaveLength(11)
    expect(noCounts.primitives.some(primitive => primitive.kind === 'text' && primitive.text === '2')).toBe(false)
  })
})

describe('figure validation feeds the geometry', () => {
  it('normalizes a payload before geometry is built', () => {
    const parsed = figure({ template: 'incline_force', params: { angleDeg: 30, massKg: 2, frictionCoeff: 0.5 } })
    expect(parsed.template).toBe('incline_force')
    if (parsed.template !== 'incline_force') return
    const layout = buildInclineForceLayout(parsed.params)
    expect(layout.primitives.length).toBeGreaterThan(10)
  })

  it('derives shells from the atom symbol', () => {
    const parsed = figure({ template: 'atom_shell', params: { symbol: 'Na' } })
    expect(parsed.template).toBe('atom_shell')
    if (parsed.template !== 'atom_shell') return
    expect(parsed.params.shells).toEqual([2, 8, 1])
  })
})
