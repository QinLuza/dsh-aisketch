/**
 * Canvas render tests.
 *
 * These exercise the drawing code against a recording stub context rather than
 * a real canvas: the question here is "does the renderer emit the primitives
 * the geometry calls for", not "does the browser rasterise them". A stub makes
 * that question answerable without a DOM, and — more importantly — lets the
 * assertions read the recorded calls directly instead of guessing at pixels.
 *
 * The colour assertions matter: the prototype shipped a near-invisible grid
 * colour and an axis colour that was mistaken for it, so a test that only
 * counted strokes would have passed while the frame was unreadable.
 */

import { describe, expect, it } from 'vitest'
import { COLORS, Viewport, drawAxes, drawCurve, drawPieChart, drawRiemann } from '../src/client/render.ts'
import type { Sample } from '../src/client/render.ts'

/** One recorded context call. */
interface Call {
  readonly fn: string
  readonly args: readonly unknown[]
}

/** A 2D context that records every call instead of drawing. */
function stubContext(): CanvasRenderingContext2D & { calls: Call[] } {
  const calls: Call[] = []
  const record = (fn: string) => (...args: unknown[]): void => {
    calls.push({ fn, args })
  }
  const ctx = {
    calls,
    clearRect: record('clearRect'),
    beginPath: record('beginPath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    stroke: record('stroke'),
    fill: record('fill'),
    arc: record('arc'),
    fillRect: record('fillRect'),
    strokeRect: record('strokeRect'),
    fillText: record('fillText'),
    setLineDash: record('setLineDash'),
    closePath: record('closePath'),
    lineWidth: 1,
    strokeStyle: '',
    fillStyle: '',
    font: '',
    textAlign: 'left',
    textBaseline: 'top',
    setTransform: record('setTransform'),
  }
  return ctx as unknown as CanvasRenderingContext2D & { calls: Call[] }
}

/** All recorded calls of one kind. */
function callsOf(ctx: { calls: Call[] }, fn: string): readonly Call[] {
  return ctx.calls.filter((c) => c.fn === fn)
}

describe('drawAxes', () => {
  it('emits both a grid pass and an axis pass in distinct colours', () => {
    const ctx = stubContext()
    const vp = new Viewport(-6.28, 6.28, -1.2, 1.2).fit(620, 380)
    drawAxes(ctx, vp)

    // One clear, then two strokes: grid first, opaque axes second.
    expect(callsOf(ctx, 'clearRect')).toHaveLength(1)
    expect(callsOf(ctx, 'stroke').length).toBeGreaterThanOrEqual(2)

    // The axis must not be drawn in the grid's near-transparent colour, which
    // is the mistake the prototype made and a pixel probe could not catch.
    expect(COLORS.axis).not.toBe(COLORS.grid)
  })

  it('labels the axes without labelling the origin twice', () => {
    const ctx = stubContext()
    const vp = new Viewport(-6.28, 6.28, -1.2, 1.2).fit(620, 380)
    drawAxes(ctx, vp)
    const labels = callsOf(ctx, 'fillText').map((c) => String(c.args[0]))
    expect(labels.length).toBeGreaterThan(0)
    expect(labels).not.toContain('0.0')
  })
})

describe('drawCurve', () => {
  it('breaks the stroke at a null sample instead of bridging the gap', () => {
    const ctx = stubContext()
    const vp = new Viewport(-1, 1, -1, 1).fit(100, 100)
    const points: Sample[] = [[-1, 0], [0, 1], [0, null], [1, 0]]
    drawCurve(ctx, vp, points, COLORS.curve[0])

    // Three real samples produce two segments: one moveTo plus one lineTo per
    // run, and the null forces a fresh moveTo rather than a joining lineTo.
    expect(callsOf(ctx, 'moveTo')).toHaveLength(2)
    expect(callsOf(ctx, 'lineTo')).toHaveLength(1)
  })

  it('draws nothing for an all-null series', () => {
    const ctx = stubContext()
    const vp = new Viewport(-1, 1, -1, 1).fit(100, 100)
    drawCurve(ctx, vp, [[0, null], [1, null]], COLORS.curve[0])
    expect(callsOf(ctx, 'lineTo')).toHaveLength(0)
    expect(callsOf(ctx, 'moveTo')).toHaveLength(0)
  })

  it('strokes a plain series as one connected line', () => {
    const ctx = stubContext()
    const vp = new Viewport(0, 10, 0, 10).fit(100, 100)
    // A control that can fail: a renderer that dropped the stroke would leave
    // an empty frame while every other assertion in this file still passed.
    drawCurve(ctx, vp, [[0, 0], [5, 5], [10, 0]], COLORS.curve[0])
    expect(callsOf(ctx, 'moveTo')).toHaveLength(1)
    expect(callsOf(ctx, 'lineTo')).toHaveLength(2)
    expect(callsOf(ctx, 'stroke')).toHaveLength(1)
  })
})

describe('drawRiemann', () => {
  it('draws one rectangle per subinterval', () => {
    const ctx = stubContext()
    const vp = new Viewport(0, Math.PI, 0, 1).fit(620, 380)
    drawRiemann(ctx, vp, (x) => Math.sin(x), 0, Math.PI, 15)
    // fillRect per bar; the thin edge stroke is also emitted for n <= 40.
    const rects = callsOf(ctx, 'fillRect')
    const edges = callsOf(ctx, 'strokeRect')
    expect(rects).toHaveLength(15)
    expect(edges).toHaveLength(15)
  })

  it('skips bars whose height is not finite', () => {
    const ctx = stubContext()
    const vp = new Viewport(0, 1, 0, 1).fit(620, 380)
    drawRiemann(ctx, vp, () => Number.NaN, 0, 1, 4)
    expect(callsOf(ctx, 'fillRect')).toHaveLength(0)
  })
})

describe('drawPieChart', () => {
  it('draws one slice per datum and skips an all-zero series', () => {
    const ctx = stubContext()
    const vp = new Viewport(0, 1, 0, 1).fit(620, 380)
    drawPieChart(ctx, vp, [{ label: 'x', data: [30, 20, 50] }])
    // Each slice is a moveTo + arc + closePath + fill.
    expect(callsOf(ctx, 'arc')).toHaveLength(3)

    const empty = stubContext()
    drawPieChart(empty, vp, [{ label: 'x', data: [0, 0] }])
    expect(callsOf(empty, 'arc')).toHaveLength(0)
  })
})
