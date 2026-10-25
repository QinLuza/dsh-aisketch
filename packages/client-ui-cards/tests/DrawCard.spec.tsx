/**
 * The `draw` renderer as a component.
 *
 * The engine specs pin the geometry; this one pins the wiring between the
 * admitted spec and the SVG a page actually receives: the paper tiling is
 * referenced, every element type reaches the tree, the hand font class lands on
 * a handwritten label, and an unreadable payload degrades to the raw view
 * instead of throwing.
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CardSpec } from '@aisketch/cards-core'
import { DrawCard } from '../src/client/DrawCard.tsx'

/** A translate stand-in: the key is enough to prove a string reached the tree. */
const t = ((key: string) => key) as never

/** One card covering every element type. */
const card: CardSpec = {
  version: 1,
  kind: 'draw',
  title: '测试图',
  payload: {
    paper: 'grid',
    elements: [
      { type: 'shape', shape: 'rect', x: 10, y: 20, w: 100, h: 60, fill: 'yellow' },
      { type: 'path', d: 'M 0 0 C 20 40 60 40 80 0', pen: 'fountain', color: 'blue' },
      { type: 'text', x: 60, y: 140, text: '你好\n世界', hand: true },
      { type: 'tape', x: 200, y: 40, w: 80 },
      { type: 'pixels', x: 300, y: 200, cell: 8, rows: ['##', '#.'], palette: { '#': 'green' } },
    ],
  },
}

describe('DrawCard', () => {
  it('renders the paper, the sketch and the labels as SVG', () => {
    const html = renderToStaticMarkup(<DrawCard card={card} t={t} />)
    expect(html).toContain('data-card-kind="draw"')
    expect(html).toContain('cd-draw-paper-grid')
    expect(html).toContain('<svg')
    expect(html).toContain('测试图')
    expect(html).toContain('cd-draw-hand')
    expect(html).toContain('你好')
    expect(html).toContain('世界')
    // The fountain pen paints a filled outline; the rect paints a fill as well.
    expect(html).toContain('fill-opacity')
    // Every card frame carries the expand control; the overlay itself only
    // exists after a click, so the static markup proves the affordance.
    expect(html).toContain('cd-expand')
  })

  it('paints a payload background under the paper rules and the ink', () => {
    const night: CardSpec = {
      version: 1,
      kind: 'draw',
      payload: { background: '#102030', paper: 'dots', elements: [{ type: 'path', d: 'M 0 0 L 10 10' }] },
    }
    const html = renderToStaticMarkup(<DrawCard card={night} t={t} />)
    expect(html).toContain('#102030')
    // Under the rules: the background rect is emitted before the tiled paper.
    expect(html.indexOf('#102030')).toBeLessThan(html.indexOf('fill="url(#cd-draw-paper-dots)"'))
  })

  it('falls back to the raw view for an unreadable payload', () => {
    const broken: CardSpec = { version: 1, kind: 'draw', payload: { elements: [] } }
    const html = renderToStaticMarkup(<DrawCard card={broken} t={t} />)
    expect(html).toContain('cd-raw')
  })
})

describe('DrawCard gradients', () => {
  it('emits a gradient definition and fills with a reference to it', () => {
    const gradient: CardSpec = {
      version: 1,
      kind: 'draw',
      payload: {
        elements: [{
          type: 'shape', shape: 'rect', x: 0, y: 0, w: 200, h: 100, color: 'red', strokeOpacity: 0,
          fill: { type: 'linear', from: 'blue', to: 'red', angle: 180 },
        }],
      },
    }
    const html = renderToStaticMarkup(<DrawCard card={gradient} t={t} />)
    expect(html).toContain('<linearGradient')
    expect(html).toContain('url(#cdg-')
    expect(html).toContain('stop-color="#378add"')
  })
})

describe('DrawCard blend modes', () => {
  it('writes the element blend onto its paths', () => {
    const blended: CardSpec = {
      version: 1,
      kind: 'draw',
      payload: {
        elements: [{
          type: 'shape', shape: 'rect', x: 0, y: 0, w: 200, h: 100,
          color: 'white', strokeOpacity: 0, fill: 'orange', fillOpacity: 1, blend: 'screen',
        }],
      },
    }
    const html = renderToStaticMarkup(<DrawCard card={blended} t={t} />)
    expect(html).toContain('mix-blend-mode:screen')
  })
})

describe('DrawCard blur', () => {
  it('writes half the spread as a CSS blur', () => {
    const soft: CardSpec = {
      version: 1,
      kind: 'draw',
      payload: {
        elements: [{
          type: 'shape', shape: 'rect', x: 0, y: 0, w: 200, h: 100,
          color: 'white', strokeOpacity: 0, fill: 'orange', fillOpacity: 1, blur: 30,
        }],
      },
    }
    const html = renderToStaticMarkup(<DrawCard card={soft} t={t} />)
    expect(html).toContain('blur(15px)')
  })
})
