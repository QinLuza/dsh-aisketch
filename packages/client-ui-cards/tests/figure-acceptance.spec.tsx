/**
 * The v1 teaching-figure acceptance set: ten physics and ten chemistry cards.
 *
 * It is intentionally a template acceptance set, not a demand-coverage study:
 * every case is expected to be expressible by the two released templates. The
 * coverage question (how many real questions need a different template) still
 * needs a separate, broader sample.
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CardSpec } from '@aisketch/cards-core'
import { FigureCard } from '../src/client/FigureCard.tsx'

const t = ((key: string) => key) as never

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

const chemistryCases = ['H', 'He', 'Li', 'C', 'O', 'Ne', 'Na', 'Mg', 'Cl', 'Ca']

function card(payload: Record<string, unknown>, title: string): CardSpec {
  return { version: 1, kind: 'figure', title, payload }
}

describe('physics 10', () => {
  it.each(physicsCases)('renders an incline force case: %o', params => {
    const html = renderToStaticMarkup(<FigureCard card={card({ template: 'incline_force', params }, '斜面受力')} t={t} />)
    expect(html).toContain('data-card-kind="figure"')
    expect(html).toContain('data-role="vector:G"')
    expect(html).toContain('data-role="vector:N"')
    expect(html).toContain('θ =')
  })
})

describe('chemistry 10', () => {
  it.each(chemistryCases)('renders a neutral atom: %s', symbol => {
    const html = renderToStaticMarkup(<FigureCard card={card({ template: 'atom_shell', params: { symbol } }, `${symbol} 原子结构`)} t={t} />)
    expect(html).toContain('data-card-kind="figure"')
    expect(html).toContain('K shell')
    expect(html).toContain(symbol)
    expect(html).toContain('electron count = Z =')
  })
})
