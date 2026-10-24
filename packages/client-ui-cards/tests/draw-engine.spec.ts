/**
 * The draw engine's pure functions.
 *
 * The card itself is verified by drawing on a real page; these specs pin the
 * properties that make it deterministic and make each pen recognisable: the
 * flattened geometry ends exactly where the path says, the seeded wobble
 * repeats for the same seed, and the pen recipes taper and widen the way their
 * names promise.
 */
import { describe, expect, it } from 'vitest'
import type { DrawShapeElement } from '@aisketch/cards-core'
import { parseDrawPathData } from '@aisketch/cards-core'
import {
  arrowHeadPaths, dashArrayFor, flattenPathCommands, jitterPoints, outlineSubpath, penSpec,
  pixelParts, polylineD, renderPathElement, renderShapeElement, rngFor, shapeOutline, tapePath, wobblePolyline,
} from '../src/client/draw-engine.ts'

describe('flattenPathCommands', () => {
  it('keeps subpaths apart and lands exactly on each endpoint', () => {
    const parsed = parseDrawPathData('M 0 0 L 10 0 M 20 0 L 30 0')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const subpaths = flattenPathCommands(parsed.commands)
    expect(subpaths).toHaveLength(2)
    expect(subpaths[0]?.[0]).toEqual({ x: 0, y: 0 })
    expect(subpaths[0]?.[subpaths[0].length - 1]).toEqual({ x: 10, y: 0 })
    expect(subpaths[1]?.[0]).toEqual({ x: 20, y: 0 })
  })

  it('samples a cubic into steps and ends on the endpoint', () => {
    const parsed = parseDrawPathData('M 0 0 C 10 20 20 20 30 0')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const subpaths = flattenPathCommands(parsed.commands)
    expect(subpaths[0]?.length).toBe(13)
    expect(subpaths[0]?.[12]).toEqual({ x: 30, y: 0 })
  })

  it('closes a subpath back to its start', () => {
    const parsed = parseDrawPathData('M 10 10 L 50 10 Z')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const subpaths = flattenPathCommands(parsed.commands)
    const points = subpaths[0] ?? []
    expect(points[points.length - 1]).toEqual({ x: 10, y: 10 })
  })

  it('samples an arc and lands on its endpoint', () => {
    const parsed = parseDrawPathData('M 0 0 A 10 10 0 0 1 20 0')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const subpaths = flattenPathCommands(parsed.commands)
    const points = subpaths[0] ?? []
    const last = points[points.length - 1]
    expect(last?.x).toBeCloseTo(20)
    expect(last?.y).toBeCloseTo(0)
    // Every arc sample must sit on the circle of radius 10 around (10, 0).
    for (const point of points) {
      expect(Math.hypot(point.x - 10, point.y)).toBeCloseTo(10, 3)
    }
  })
})

describe('penSpec', () => {
  it('gives the fountain pen thin ends and a full belly', () => {
    const spec = penSpec('fountain', 10)
    expect(spec.kind).toBe('outline')
    if (spec.kind !== 'outline') return
    expect(spec.halfWidth(0, 0)).toBeLessThan(spec.halfWidth(0.5, 0))
    expect(spec.halfWidth(1, 0)).toBeLessThan(spec.halfWidth(0.5, 0))
  })

  it('makes the calligraphy nib direction-dependent', () => {
    const spec = penSpec('calligraphy', 10)
    expect(spec.kind).toBe('outline')
    if (spec.kind !== 'outline') return
    const vertical = spec.halfWidth(0, Math.PI / 2)
    const horizontal = spec.halfWidth(0, 0)
    expect(vertical).toBeGreaterThan(horizontal)
  })

  it('tapers the brush from start to finish', () => {
    const spec = penSpec('brush', 10)
    expect(spec.kind).toBe('outline')
    if (spec.kind !== 'outline') return
    expect(spec.halfWidth(0, 0)).toBeGreaterThan(spec.halfWidth(0.9, 0))
  })

  it('keeps the ballpoint constant and orders the wide pens by opacity', () => {
    const ball = penSpec('ball', 8)
    const marker = penSpec('marker', 8)
    const highlighter = penSpec('highlighter', 8)
    expect(ball.kind).toBe('stroke')
    expect(marker.kind).toBe('stroke')
    expect(highlighter.kind).toBe('stroke')
    if (ball.kind !== 'stroke' || marker.kind !== 'stroke' || highlighter.kind !== 'stroke') return
    expect(ball.width).toBe(8)
    expect(highlighter.width).toBeGreaterThan(marker.width)
    expect(highlighter.opacity).toBeLessThan(marker.opacity)
  })
})

describe('outlineSubpath', () => {
  it('is deterministic and closes into one path', () => {
    const points = Array.from({ length: 20 }, (_v, index) => ({ x: index * 5, y: Math.sin(index / 3) * 10 }))
    const first = outlineSubpath(points, t => 1 + t)
    const second = outlineSubpath(points, t => 1 + t)
    expect(first).toBe(second)
    expect(first.startsWith('M ')).toBe(true)
    expect(first.endsWith(' Z')).toBe(true)
    expect(first).not.toContain('NaN')
  })

  it('renders a single point as a pen dab instead of nothing', () => {
    expect(outlineSubpath([{ x: 5, y: 5 }], () => 2)).toContain('A')
  })
})

describe('wobblePolyline', () => {
  it('is seeded: the same seed repeats and another seed differs', () => {
    const line = [{ x: 0, y: 0 }, { x: 200, y: 0 }]
    expect(wobblePolyline(line, false, rngFor(7))).toEqual(wobblePolyline(line, false, rngFor(7)))
    expect(wobblePolyline(line, false, rngFor(8))).not.toEqual(wobblePolyline(line, false, rngFor(7)))
  })

  it('adds points between corners without moving the corners', () => {
    const line = [{ x: 0, y: 0 }, { x: 200, y: 0 }]
    const points = wobblePolyline(line, false, rngFor(1))
    expect(points.length).toBeGreaterThan(2)
    expect(points[0]).toEqual({ x: 0, y: 0 })
    expect(points[points.length - 1]).toEqual({ x: 200, y: 0 })
    for (const point of points.slice(1, -1)) {
      expect(Math.abs(point.y)).toBeLessThanOrEqual(1.35 + 1e-9)
    }
  })

  it('keeps a closed shape closed by not repeating the first point', () => {
    const square = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
    const points = wobblePolyline(square, true, rngFor(2))
    expect(points[0]).toEqual({ x: 0, y: 0 })
    expect(points[points.length - 1]).not.toEqual({ x: 0, y: 0 })
  })
})

describe('jitterPoints', () => {
  it('stays inside the requested amplitude', () => {
    const origins = [{ x: 10, y: 10 }, { x: 20, y: 20 }]
    const points = jitterPoints(origins, rngFor(3), 0.9)
    expect(points).toHaveLength(2)
    for (let index = 0; index < points.length; index += 1) {
      expect(Math.abs(points[index]!.x - origins[index]!.x)).toBeLessThanOrEqual(0.9 + 1e-9)
      expect(Math.abs(points[index]!.y - origins[index]!.y)).toBeLessThanOrEqual(0.9 + 1e-9)
    }
  })
})

describe('shape rendering', () => {
  /** One clean rectangle, the base every case tweaks. */
  const rect: DrawShapeElement = {
    type: 'shape', shape: 'rect', x: 10, y: 20, w: 100, h: 50,
    color: 'red', fill: 'yellow', width: 2, dash: 'solid', arrowStart: false, rough: false,
  }

  it('draws the fill before the stroke', () => {
    const parts = renderShapeElement(rect, rngFor(1))
    expect(parts.map(part => part.kind)).toEqual(['fill', 'stroke'])
    expect(parts[0]).toMatchObject({ color: '#f9ab00', opacity: 0.25 })
    expect(parts[1]).toMatchObject({ color: '#c5221f', width: 2 })
  })

  it('emits arrowheads after the shaft, one per requested end', () => {
    const arrow: DrawShapeElement = { ...rect, shape: 'arrow', fill: undefined, w: 100, h: 0 }
    const parts = renderShapeElement(arrow, rngFor(1))
    expect(parts.filter(part => part.kind === 'fill')).toHaveLength(1)
    expect(parts[parts.length - 1]?.kind).toBe('fill')
    expect(arrowHeadPaths(arrow)).toHaveLength(1)
    expect(arrowHeadPaths({ ...arrow, arrowStart: true })).toHaveLength(2)
  })

  it('wobbles a rough shape and leaves a clean one exact', () => {
    const clean = renderShapeElement(rect, rngFor(1))
    const rough = renderShapeElement({ ...rect, rough: true }, rngFor(1))
    const cleanStroke = clean[1]
    const roughStroke = rough[1]
    expect(cleanStroke?.kind).toBe('stroke')
    expect(roughStroke?.kind).toBe('stroke')
    if (cleanStroke?.kind !== 'stroke' || roughStroke?.kind !== 'stroke') return
    expect(roughStroke.d.length).toBeGreaterThan(cleanStroke.d.length)
  })

  it('maps dash styles to stroke patterns', () => {
    expect(dashArrayFor('solid')).toBeUndefined()
    expect(dashArrayFor('dashed')).toBe('8 6')
    expect(dashArrayFor('dotted')).toBe('0.1 5')
  })

  it('samples an ellipse into a closed outline through its rightmost point', () => {
    const outline = shapeOutline('ellipse', 0, 0, 100, 60)
    expect(outline.closed).toBe(true)
    expect(outline.points).toHaveLength(48)
    expect(outline.points[0]).toEqual({ x: 100, y: 30 })
  })

  it('draws a line without closing it', () => {
    const outline = shapeOutline('line', 0, 0, 50, 25)
    expect(outline.closed).toBe(false)
    expect(outline.points).toEqual([{ x: 0, y: 0 }, { x: 50, y: 25 }])
  })

  it('falls back to the theme ink when no color is given', () => {
    const parts = renderShapeElement({ ...rect, color: undefined, fill: undefined }, rngFor(1))
    const stroke = parts[0]
    expect(stroke?.kind).toBe('stroke')
    if (stroke?.kind !== 'stroke') return
    expect(stroke.color).toContain('var(--dsw-alias-text-primary')
  })
})

describe('path rendering', () => {
  /** One straight centerline, the base every pen case reuses. */
  const line = { type: 'path' as const, d: 'M 0 0 L 100 0', pen: 'ball' as const, color: 'blue', width: 3 }

  it('strokes a ballpoint path with one part', () => {
    const parts = renderPathElement({ ...line, pen: 'ball' }, rngFor(1))
    expect(parts).toHaveLength(1)
    expect(parts[0]).toMatchObject({ kind: 'stroke', color: '#378add', width: 3, cap: 'round' })
  })

  it('adds a grain pass for the pencil', () => {
    const parts = renderPathElement({ ...line, pen: 'pencil' }, rngFor(1))
    expect(parts).toHaveLength(2)
    expect(parts[1]?.kind).toBe('stroke')
  })

  it('fills a variable-width outline for a fountain pen', () => {
    const parts = renderPathElement({ ...line, pen: 'fountain' }, rngFor(1))
    expect(parts).toHaveLength(1)
    expect(parts[0]?.kind).toBe('fill')
    if (parts[0]?.kind !== 'fill') return
    expect(parts[0].d.endsWith(' Z')).toBe(true)
  })

  it('returns nothing for a d that does not parse', () => {
    expect(renderPathElement({ ...line, d: 'L 10 10' }, rngFor(1))).toHaveLength(0)
  })
})

describe('pixelParts', () => {
  it('groups painted cells into one fill per color', () => {
    const parts = pixelParts({
      type: 'pixels', x: 10, y: 20, cell: 5,
      rows: ['##.', '#..'],
      palette: { '#': 'red', '.': 'blue' },
    })
    expect(parts).toHaveLength(2)
    const red = parts.find(part => part.color === '#c5221f')
    const blue = parts.find(part => part.color === '#378add')
    expect(red?.kind).toBe('fill')
    expect(blue?.kind).toBe('fill')
    if (red?.kind !== 'fill' || blue?.kind !== 'fill') return
    // Three '#' cells and three '.' cells.
    expect(red.d.split('M ').length - 1).toBe(3)
    expect(blue.d.split('M ').length - 1).toBe(3)
    expect(red.opacity).toBe(1)
  })

  it('places the first cell at the element origin and skips unknown characters', () => {
    const parts = pixelParts({ type: 'pixels', x: 10, y: 20, cell: 5, rows: ['#x'], palette: { '#': 'red' } })
    expect(parts).toHaveLength(1)
    const part = parts[0]
    expect(part?.kind).toBe('fill')
    if (part?.kind !== 'fill') return
    expect(part.d.startsWith('M 10 20')).toBe(true)
    expect(part.d.split('M ').length - 1).toBe(1)
  })

  it('emits nothing when no character is painted', () => {
    expect(pixelParts({ type: 'pixels', x: 0, y: 0, cell: 4, rows: ['..'], palette: { '#': 'red' } })).toHaveLength(0)
  })
})

describe('the primitives the renderer builds on', () => {
  it('emits a zero-length dab for a single point and closes when asked', () => {
    expect(polylineD([{ x: 1, y: 2 }], false)).toBe('M 1 2 L 1 2')
    expect(polylineD([{ x: 0, y: 0 }, { x: 10, y: 0 }], true)).toBe('M 0 0 L 10 0 Z')
  })

  it('draws tape as a closed band', () => {
    const d = tapePath({ type: 'tape', x: 0, y: 0, w: 120, h: 26, color: undefined, angle: -6 }, rngFor(1))
    expect(d.startsWith('M ')).toBe(true)
    expect(d.endsWith(' Z')).toBe(true)
  })

  it('repeats a seed sequence and diverges for another seed', () => {
    const first = rngFor(3)
    const second = rngFor(3)
    expect([first(), first(), first()]).toEqual([second(), second(), second()])
    expect(rngFor(4)()).not.toBe(rngFor(3)())
  })
})
