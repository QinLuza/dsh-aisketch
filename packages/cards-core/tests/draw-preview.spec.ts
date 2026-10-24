/**
 * Display-list and diagnostics tests: the picture before it becomes pixels.
 *
 * Two properties are pinned here. First, the display list is the drawing -- the
 * ink the browser paints, described in numbers -- so a payload's elements must
 * map onto it one for one, in paint order. Second, the self-check must only ever
 * report faults that are really there: the wobble the engine adds is not a
 * composition error, an element painted before a caption is not covering it, and
 * a clean drawing must come back with an empty warning list.
 */

import { describe, expect, it } from 'vitest'
import { buildDrawDisplayList, parseDrawPayload } from '../src/index.ts'
import { analyzeDraw, formatDrawDiagnostics } from '../src/draw-diagnostics.ts'
import { drawSvgMarkup, elementInks, textInkBlocks } from '../src/draw-render.ts'
import type { DrawInkBlock } from '../src/draw-render.ts'

/** The smallest canvas the payload contract admits. */
const SIZE = { w: 160, h: 120 }

/** Build a display list, failing the test if the payload does not parse. */
function listOf(elements: readonly unknown[], size = SIZE) {
  const draw = parseDrawPayload({ size, paper: 'plain', elements })
  if (draw === null) throw new Error('test payload did not parse')
  return buildDrawDisplayList(draw)
}

/** A rectangle element. */
function rect(x: number, y: number, w: number, h: number, extra: Record<string, unknown> = {}): unknown {
  return { type: 'shape', shape: 'rect', x, y, w, h, color: 'red', width: 2, ...extra }
}

/** A caption element. */
function caption(x: number, y: number, text = '标题'): unknown {
  return { type: 'text', x, y, text, size: 16, color: 'black' }
}

describe('building the display list', () => {
  it('keeps one group per element, in paint order', () => {
    const list = listOf([rect(0, 0, 40, 30), caption(10, 60)])
    expect(list.groups).toHaveLength(2)
    expect(list.groups.map(group => group.type)).toEqual(['shape', 'text'])
    expect(list.groups.map(group => group.index)).toEqual([0, 1])
  })

  it('turns a path element into polyline ink with the pen width', () => {
    const list = listOf([{ type: 'path', d: 'M 10 10 L 60 40', pen: 'ball', color: 'blue', width: 4 }])
    const polylines = list.paints.filter(ink => ink.kind === 'polyline')
    expect(polylines.length).toBeGreaterThan(0)
    expect(polylines[0]).toMatchObject({ kind: 'polyline', color: '#378add' })
  })

  it('carries a path fill opacity into the paint, so an organic wash is really translucent', () => {
    const list = listOf([{
      type: 'path',
      d: 'M 10 100 C 20 20 140 20 150 100 Z',
      pen: 'fountain',
      color: 'green',
      fill: 'green',
      fillOpacity: 0.4,
    }])
    const fills = list.paints.filter(ink => ink.kind === 'polygon')
    expect(fills.some(ink => ink.opacity === 0.4)).toBe(true)
  })

  it('turns a caption into one footprint per non-space character', () => {
    const list = listOf([caption(10, 60, '山 湖')])
    const blocks = list.paints.filter((ink): ink is DrawInkBlock => ink.kind === 'block')
    expect(blocks).toHaveLength(2)
  })

  it('measures text footprints as full-width for CJK and half-width for Latin', () => {
    const cjk = textInkBlocks({ type: 'text', x: 0, y: 40, text: '字', size: 20, color: undefined, bold: false, anchor: 'start', hand: false })
    const latin = textInkBlocks({ type: 'text', x: 0, y: 40, text: 'i', size: 20, color: undefined, bold: false, anchor: 'start', hand: false })
    expect(cjk[0]!.w).toBeGreaterThan(latin[0]!.w * 1.4)
  })

  it('anchors a caption around its x', () => {
    const start = textInkBlocks({ type: 'text', x: 80, y: 40, text: 'ab', size: 20, color: undefined, bold: false, anchor: 'start', hand: false })
    const middle = textInkBlocks({ type: 'text', x: 80, y: 40, text: 'ab', size: 20, color: undefined, bold: false, anchor: 'middle', hand: false })
    const end = textInkBlocks({ type: 'text', x: 80, y: 40, text: 'ab', size: 20, color: undefined, bold: false, anchor: 'end', hand: false })
    expect(start[0]!.x).toBeGreaterThan(80)
    expect(middle[0]!.x).toBeLessThan(start[0]!.x)
    expect(end[0]!.x).toBeLessThan(middle[0]!.x)
  })

  it('resolves theme ink to a concrete color, because an offscreen raster has no theme', () => {
    const inks = elementInks(
      { type: 'shape', shape: 'rect', x: 0, y: 0, w: 20, h: 20, color: undefined, fill: undefined, width: 2, dash: 'solid', arrowStart: false, rough: false },
      0,
    )
    for (const ink of inks) expect(ink.color).not.toContain('var(')
  })

  it('serializes a standalone SVG that names the canvas and the background', () => {
    const markup = drawSvgMarkup(listOf([rect(10, 10, 40, 30)]), '标题')
    expect(markup.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
    expect(markup).toContain('width="160"')
    expect(markup).toContain('height="120"')
    expect(markup).toContain('<title>标题</title>')
    expect(markup).toContain('<rect x="0" y="0" width="160" height="120"')
    expect(markup).toContain('<polyline')
    expect(markup.endsWith('</svg>')).toBe(true)
  })
})

describe('the self-check', () => {
  it('reports a clean drawing as clean', () => {
    // A balanced scene: the ink reaches all four edge bands, sits centred, uses
    // three colors, and the caption is painted last so nothing covers it.
    const diagnostics = analyzeDraw(listOf([rect(16, 8, 128, 104, { fill: 'yellow' }), caption(60, 70)]))
    expect(diagnostics.warnings).toEqual([])
  })

  it('names elements that draw nothing on the canvas', () => {
    const diagnostics = analyzeDraw(listOf([rect(400, 400, 30, 30)]))
    expect(diagnostics.outside).toHaveLength(1)
    expect(diagnostics.outside[0]).toMatchObject({ index: 0, type: 'shape' })
    expect(diagnostics.warnings.join(' ')).toContain('draw nothing on the canvas')
  })

  it('does not mistake hand-drawn wobble for a composition mistake', () => {
    // A shape placed exactly against the edges wanders ~1.35 units past them.
    const diagnostics = analyzeDraw(listOf([rect(0, 0, SIZE.w, SIZE.h, { fill: 'blue' })]))
    expect(diagnostics.clipped).toEqual([])
  })

  it('reports text buried under ink that is painted later', () => {
    const diagnostics = analyzeDraw(listOf([caption(20, 60, '山谷'), rect(10, 40, 120, 40, { fill: 'teal' })]))
    expect(diagnostics.warnings.join(' ')).toContain('buried under other ink')
  })

  it('does not report text over ink that is painted earlier, because that is behind it', () => {
    const diagnostics = analyzeDraw(listOf([rect(10, 40, 120, 40, { fill: 'teal' }), caption(20, 60, '山谷')]))
    expect(diagnostics.warnings.join(' ')).not.toContain('buried')
  })

  it('reports a palette that has grown past a readable set of hues', () => {
    // Nine genuinely different hues, not nine shades of one.
    const colors = ['#ff0000', '#ff8800', '#ffee00', '#33cc33', '#00cccc', '#0066ff', '#6600ff', '#cc00ff', '#ff00cc']
    const elements = colors.map((color, index) => rect(4, 4 + index * 8, 12, 6, { color }))
    const diagnostics = analyzeDraw(listOf(elements))
    expect(diagnostics.hueFamilies.length).toBeGreaterThan(7)
    expect(diagnostics.warnings.join(' ')).toContain('hue families')
  })

  it('counts a lightness ramp as one hue family, not as a dozen colors', () => {
    // A sky gradient: the same blue at six lightness steps.
    const ramp = ['#123a5a', '#1d4f74', '#2a668e', '#387ea8', '#4a97c0', '#63b0d4']
    const elements = ramp.map((color, index) => rect(0, index * 16, 150, 12, { color, fill: color, fillOpacity: 1 }))
    const diagnostics = analyzeDraw(listOf(elements))
    expect(diagnostics.colors.length).toBeGreaterThan(4)
    expect(diagnostics.hueFamilies.length).toBeLessThanOrEqual(2)
    expect(diagnostics.warnings.join(' ')).not.toContain('hue families')
  })

  it('reports the canvas sides that carry no ink', () => {
    const diagnostics = analyzeDraw(listOf([rect(60, 50, 30, 25)]))
    expect(diagnostics.emptyEdges).toContain('left')
    expect(diagnostics.warnings.join(' ')).toContain('edge band')
  })

  it('reports where the ink weight actually sits', () => {
    const right = analyzeDraw(listOf([rect(110, 40, 40, 40)]))
    expect(right.balance.dx).toBeGreaterThan(0.1)
    const left = analyzeDraw(listOf([rect(10, 40, 40, 40)]))
    expect(left.balance.dx).toBeLessThan(-0.1)
  })

  it('formats one machine-readable header line and one line per warning', () => {
    const diagnostics = analyzeDraw(listOf([rect(400, 400, 30, 30)]))
    const text = formatDrawDiagnostics(diagnostics)
    expect(text.split('\n')[0]).toContain('<self-check>canvas 160x120')
    expect(text).toContain('1 element(s): 1 shape')
    expect(text).toContain('</self-check>')
    expect(text.split('\n').filter(line => line.startsWith('- ')).length).toBeGreaterThan(0)
  })
})
