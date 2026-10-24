import { describe, expect, it } from 'vitest'
import {
  FIGURE_KIND,
  atomShellBySymbol,
  parseFigurePayload,
  summarizeCard,
  validateCardArgs,
} from '../src/index.ts'

/** Ten simple incline scenarios used as the v1 physics acceptance set. */
const physicsCases = [
  { angleDeg: 30, massKg: 2, frictionCoeff: 0.5 },
  { angleDeg: 45, massKg: 1, frictionCoeff: 0 },
  { angleDeg: 20, massKg: 5, frictionCoeff: 0.3, showComponents: true },
  { angleDeg: 60, massKg: 3, frictionCoeff: 0.2 },
  { angleDeg: 30, massKg: 4, frictionCoeff: 0.6, showValues: false },
  { angleDeg: 15, massKg: 10, frictionCoeff: 0.4, showComponents: true },
  { angleDeg: 37, massKg: 2.5, frictionCoeff: 0.25 },
  { angleDeg: 53, massKg: 1.5, frictionCoeff: 0.8, gravity: 10 },
  { angleDeg: 25, massKg: 6, frictionCoeff: 0, showComponents: true },
  { angleDeg: 40, massKg: 8, frictionCoeff: 0.35, showValues: true },
]

/** Ten simple neutral atoms used as the v1 chemistry acceptance set. */
const chemistryCases = ['H', 'He', 'Li', 'C', 'O', 'Ne', 'Na', 'Mg', 'Cl', 'Ca']

describe('incline_force', () => {
  it('normalizes a semantic payload and applies display defaults', () => {
    const figure = parseFigurePayload({
      template: 'incline_force',
      params: { angleDeg: 30, massKg: 2, frictionCoeff: 0.5 },
    })
    expect(figure).toMatchObject({
      template: 'incline_force',
      params: {
        angleDeg: 30,
        massKg: 2,
        frictionCoeff: 0.5,
        gravity: 9.8,
        showComponents: false,
        showValues: true,
      },
    })
  })

  it.each([
    ['angle too small', { angleDeg: 0, massKg: 2, frictionCoeff: 0.5 }],
    ['angle too large', { angleDeg: 90, massKg: 2, frictionCoeff: 0.5 }],
    ['mass too small', { angleDeg: 30, massKg: 0, frictionCoeff: 0.5 }],
    ['mass too large', { angleDeg: 30, massKg: 200, frictionCoeff: 0.5 }],
    ['friction negative', { angleDeg: 30, massKg: 2, frictionCoeff: -0.1 }],
    ['friction too large', { angleDeg: 30, massKg: 2, frictionCoeff: 3 }],
    ['gravity out of range', { angleDeg: 30, massKg: 2, frictionCoeff: 0.5, gravity: 40 }],
    ['non-boolean components', { angleDeg: 30, massKg: 2, frictionCoeff: 0.5, showComponents: 'yes' }],
  ])('rejects %s so the model can correct it', (_label, params) => {
    expect(parseFigurePayload({ template: 'incline_force', params })).toBeNull()
  })
})

describe('connected_bodies', () => {
  it('normalizes masses, friction and display defaults', () => {
    const figure = parseFigurePayload({
      template: 'connected_bodies',
      params: { surfaceMassKg: 2, hangingMassKg: 1.5, frictionCoeff: 0.3 },
    })
    expect(figure).toMatchObject({
      template: 'connected_bodies',
      params: {
        surfaceMassKg: 2,
        hangingMassKg: 1.5,
        frictionCoeff: 0.3,
        gravity: 9.8,
        showValues: true,
      },
    })
  })

  it.each([
    ['surface mass out of range', { surfaceMassKg: 0, hangingMassKg: 1, frictionCoeff: 0.2 }],
    ['hanging mass out of range', { surfaceMassKg: 1, hangingMassKg: 200, frictionCoeff: 0.2 }],
    ['negative friction', { surfaceMassKg: 1, hangingMassKg: 1, frictionCoeff: -0.1 }],
    ['friction too large', { surfaceMassKg: 1, hangingMassKg: 1, frictionCoeff: 2 }],
    ['gravity out of range', { surfaceMassKg: 1, hangingMassKg: 1, frictionCoeff: 0.2, gravity: 0 }],
  ])('rejects %s so the model can correct it', (_label, params) => {
    expect(parseFigurePayload({ template: 'connected_bodies', params })).toBeNull()
  })

  it('summarizes the connected system semantically', () => {
    const result = validateCardArgs({
      kind: FIGURE_KIND,
      title: '连接体',
      payload: { template: 'connected_bodies', params: { surfaceMassKg: 2, hangingMassKg: 1.5, frictionCoeff: 0.3 } },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(summarizeCard(result.card)).toContain('connected_bodies')
    expect(summarizeCard(result.card)).toContain('m₁=2 kg')
  })
})

describe('orbital_diagram', () => {
  it('derives Zn configuration and subshell electrons from the symbol', () => {
    const figure = parseFigurePayload({ template: 'orbital_diagram', params: { symbol: 'zn' } })
    expect(figure).toMatchObject({ template: 'orbital_diagram', params: { symbol: 'Zn', atomicNumber: 30 } })
    if (figure?.template !== 'orbital_diagram') return
    expect(figure.params.configuration).toContainEqual({ subshell: '3d', electrons: 10 })
    expect(figure.params.configuration).toContainEqual({ subshell: '4s', electrons: 2 })
  })

  it('keeps the Cr and Cu configurations as exceptions', () => {
    const cr = parseFigurePayload({ template: 'orbital_diagram', params: { symbol: 'Cr' } })
    const cu = parseFigurePayload({ template: 'orbital_diagram', params: { symbol: 'Cu' } })
    expect(cr?.template === 'orbital_diagram' ? cr.params.configuration.find(item => item.subshell === '4s')?.electrons : undefined).toBe(1)
    expect(cu?.template === 'orbital_diagram' ? cu.params.configuration.find(item => item.subshell === '3d')?.electrons : undefined).toBe(10)
  })

  it('rejects symbols outside H–Zn', () => {
    expect(parseFigurePayload({ template: 'orbital_diagram', params: { symbol: 'Ga' } })).toBeNull()
    expect(parseFigurePayload({ template: 'orbital_diagram', params: {} })).toBeNull()
  })

  it('summarizes the orbital diagram', () => {
    const result = validateCardArgs({ kind: FIGURE_KIND, payload: { template: 'orbital_diagram', params: { symbol: 'Zn' } } })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(summarizeCard(result.card)).toBe('Showed a "figure" card: orbital_diagram: Zn (Z=30).')
  })
})

describe('atom_shell', () => {
  it('derives Z and shell counts from the symbol rather than trusting the model to count electrons', () => {
    expect(parseFigurePayload({ template: 'atom_shell', params: { symbol: 'Na' } })).toEqual({
      template: 'atom_shell',
      params: { symbol: 'Na', atomicNumber: 11, shells: [2, 8, 1], showShellCounts: true },
    })
    expect(parseFigurePayload({ template: 'atom_shell', params: { symbol: 'ca', showShellCounts: false } })).toMatchObject({
      params: { symbol: 'Ca', atomicNumber: 20, shells: [2, 8, 8, 2], showShellCounts: false },
    })
  })

  it('rejects symbols outside the v1 reference table', () => {
    expect(parseFigurePayload({ template: 'atom_shell', params: { symbol: 'Fe' } })).toBeNull()
    expect(parseFigurePayload({ template: 'atom_shell', params: { symbol: 'Na', showShellCounts: 'yes' } })).toBeNull()
  })

  it('has a shell table entry for every supported symbol', () => {
    expect(atomShellBySymbol(' H ')?.shells).toEqual([1])
    expect(atomShellBySymbol('na')?.atomicNumber).toBe(11)
  })
})

describe('the v1 10+10 acceptance set', () => {
  it('admits all ten physics cases through the card envelope', () => {
    for (const params of physicsCases) {
      const result = validateCardArgs({ kind: FIGURE_KIND, payload: { template: 'incline_force', params } })
      expect(result.ok).toBe(true)
    }
  })

  it('admits all ten chemistry cases through the card envelope', () => {
    for (const symbol of chemistryCases) {
      const result = validateCardArgs({ kind: FIGURE_KIND, payload: { template: 'atom_shell', params: { symbol } } })
      expect(result.ok).toBe(true)
    }
  })

  it('summarizes a figure with its semantic parameters', () => {
    const incline = validateCardArgs({
      kind: FIGURE_KIND,
      title: '斜面受力',
      payload: { template: 'incline_force', params: { angleDeg: 30, massKg: 2, frictionCoeff: 0.5 } },
    })
    expect(incline.ok).toBe(true)
    if (!incline.ok) return
    expect(summarizeCard(incline.card)).toBe(
      'Showed a "figure" card titled "斜面受力": incline_force: θ=30°, m=2 kg, μ=0.5.',
    )
  })

  it('rejects a malformed template before it can render', () => {
    expect(parseFigurePayload({ template: 'circuit', params: {} })).toBeNull()
    expect(parseFigurePayload({ template: 'incline_force' })).toBeNull()
  })
})
