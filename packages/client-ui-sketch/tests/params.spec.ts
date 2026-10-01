/**
 * Parameter interaction primitives: the local value map, the slider step, and
 * the y-window union that keeps the axes still while any parameter is dragged.
 *
 * These are pure functions over the persisted spec, so the interaction layer's
 * two known traps are testable without a DOM: a window that follows the current
 * value (the "axes move, curve doesn't" defect), and a degenerate parameter box
 * that yields a zero or NaN slider step.
 */
import { describe, expect, it } from 'vitest'
import { resolveGeometry } from '@gk/sketch-core'
import type { SketchSpec } from '@gk/sketch-core'
import { freezeWindow, initialValues, stepOf, withValues } from '../src/client/params.ts'

describe('initialValues', () => {
  it('rests every parameter at the value the call declared', () => {
    expect(initialValues({ expr: 'A*sin(w*x+p)', params: { A: [0.2, 2, 1], w: [0.5, 4, 0.5], p: [0, 6.28, 0] } }))
      .toEqual({ A: 1, w: 0.5, p: 0 })
  })

  it('is empty for a spec with no parameters', () => {
    expect(initialValues({ expr: 'sin(x)' })).toEqual({})
  })
})

describe('withValues', () => {
  const spec: SketchSpec = { expr: 'A*x', params: { A: [0, 10, 2] }, range: [-1, 1], compare: ['x'] }

  it('replaces only the current slot of each declared parameter', () => {
    expect(withValues(spec, { A: 7 })).toEqual({
      expr: 'A*x', params: { A: [0, 10, 7] }, range: [-1, 1], compare: ['x'],
    })
  })

  it('ignores keys the spec never declared and leaves the spec alone when there are none', () => {
    expect(withValues(spec, { Z: 1 })).toEqual(spec)
    expect(withValues({ expr: 'sin(x)' }, { A: 1 })).toEqual({ expr: 'sin(x)' })
  })
})

describe('stepOf', () => {
  it('divides the declared box into 200 stops', () => {
    expect(stepOf([0, 10, 5])).toBeCloseTo(0.05)
  })

  it('stays a positive finite number for a degenerate or broken box', () => {
    for (const tuple of [[5, 5, 5], [Number.NaN, 1, 0], [1, Number.NaN, 0]] as const) {
      const step = stepOf(tuple)
      expect(Number.isFinite(step)).toBe(true)
      expect(step).toBeGreaterThan(0)
    }
  })
})

describe('freezeWindow', () => {
  const spec: SketchSpec = { expr: 'A*sin(x)+p', params: { A: [0.2, 3, 1], p: [-5, 5, 0] } }

  it('covers the amplitude box and the offset box at once', () => {
    const { yMin, yMax } = freezeWindow(spec)
    // The worst corner is A=3 with p=5, and the engine clips 2% off each tail,
    // so the held window must reach past 7.5 rather than the raw 8.
    expect(yMin).toBeLessThan(-7.5)
    expect(yMax).toBeGreaterThan(7.5)
  })

  it('depends on the declared boxes, not on where the parameters currently rest', () => {
    const moved = withValues(spec, { A: 3, p: 5 })
    expect(freezeWindow(moved)).toEqual(freezeWindow(spec))
  })

  it('holds a curve that a live resample would push out of the frame', () => {
    const window = freezeWindow(spec)
    const dragged = resolveGeometry(withValues(spec, { A: 3, p: 5 }), { frozenYRange: window })
    const drawn = dragged.curves[0]?.points ?? []
    const offFrame = drawn.filter((point) => point.y !== null && (point.y < window.yMin || point.y > window.yMax))
    expect(offFrame).toHaveLength(0)
  })

  it('falls back to the engine window for a parameter-free spec', () => {
    expect(freezeWindow({ expr: 'sin(x)' })).toEqual(resolveGeometry({ expr: 'sin(x)' }).yRange)
  })
})
