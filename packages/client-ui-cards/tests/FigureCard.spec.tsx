/**
 * The figure renderer as a component.
 *
 * These tests pin the visible contract of a semantic figure: a plain SVG on a
 * scientific surface, no freehand/paper decorations, and the semantic labels
 * the renderer derives. Geometry correctness is covered by figure-geometry.spec.
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CardSpec } from '@aisketch/cards-core'
import { FigureCard } from '../src/client/FigureCard.tsx'

/** A translate stand-in; the key is enough to prove a string reached the tree. */
const t = ((key: string) => key) as never

const incline: CardSpec = {
  version: 1,
  kind: 'figure',
  title: '斜面受力',
  payload: {
    template: 'incline_force',
    params: { angleDeg: 30, massKg: 2, frictionCoeff: 0.5, showComponents: true },
  },
}

const atom: CardSpec = {
  version: 1,
  kind: 'figure',
  title: '钠原子结构',
  payload: { template: 'atom_shell', params: { symbol: 'Na' } },
}

const connected: CardSpec = {
  version: 1,
  kind: 'figure',
  title: '连接体受力',
  payload: {
    template: 'connected_bodies',
    params: { surfaceMassKg: 2, hangingMassKg: 1.5, frictionCoeff: 0.3 },
  },
}

const orbital: CardSpec = {
  version: 1,
  kind: 'figure',
  title: 'Zn 电子排布',
  payload: { template: 'orbital_diagram', params: { symbol: 'Zn' } },
}

describe('FigureCard', () => {
  it('renders a deterministic incline figure with force labels and no hand-drawn classes', () => {
    const html = renderToStaticMarkup(<FigureCard card={incline} t={t} />)
    expect(html).toContain('data-card-kind="figure"')
    expect(html).toContain('斜面受力')
    expect(html).toContain('<svg')
    expect(html).toContain('data-role="vector:G"')
    expect(html).toContain('data-role="vector:N"')
    expect(html).toContain('data-role="vector:f"')
    expect(html).toContain('θ = 30°')
    expect(html).toContain('G = 19.6 N')
    expect(html).toContain('figure.summary.incline')
    expect(html).not.toContain('cd-draw-hand')
    expect(html).not.toContain('cd-draw-svg')
  })

  it('renders an atom with nucleus charge, shell legend and electron counts', () => {
    const html = renderToStaticMarkup(<FigureCard card={atom} t={t} />)
    expect(html).toContain('data-card-kind="figure"')
    expect(html).toContain('+11')
    expect(html).toContain('Na')
    expect(html).toContain('K shell')
    expect(html).toContain('figure.summary.atom')
    expect(html).not.toContain('cd-draw-hand')
  })

  it('renders a table-pulley connected system with T/N/G labels', () => {
    const html = renderToStaticMarkup(<FigureCard card={connected} t={t} />)
    expect(html).toContain('data-card-kind="figure"')
    expect(html).toContain('data-role="vector:T"')
    expect(html).toContain('data-role="vector:T-hanging"')
    expect(html).toContain('data-role="vector:G₁"')
    expect(html).toContain('m₁')
    expect(html).toContain('m₂')
    expect(html).toContain('figure.summary.connected')
    expect(html).not.toContain('cd-draw-hand')
  })

  it('renders Zn electron configuration and orbital boxes', () => {
    const html = renderToStaticMarkup(<FigureCard card={orbital} t={t} />)
    expect(html).toContain('data-card-kind="figure"')
    expect(html).toContain('Zn')
    expect(html).toContain('3d¹⁰')
    expect(html).toContain('4s²')
    expect(html).toContain('figure.summary.orbital')
    expect(html).not.toContain('cd-draw-hand')
  })

  it('falls back to the raw view for an invalid figure payload', () => {
    const broken: CardSpec = {
      version: 1,
      kind: 'figure',
      payload: { template: 'incline_force', params: { angleDeg: 0, massKg: 2, frictionCoeff: 0.5 } },
    }
    const html = renderToStaticMarkup(<FigureCard card={broken} t={t} />)
    expect(html).toContain('cd-raw')
  })
})
