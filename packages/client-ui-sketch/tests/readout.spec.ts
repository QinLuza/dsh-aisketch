/**
 * Readout picking: turn a cursor position into the curve point under it.
 *
 * The evaluator is supplied already compiled, so this module stays free of the
 * parser and the whole pick is a pure function of cursor, viewport, and curves.
 * Distance is measured vertically on purpose: a hover readout answers "what is
 * y here", and a Euclidean distance would prefer steep segments over the point
 * the cursor is actually on.
 */
import { describe, expect, it } from 'vitest'
import { build } from '@aisketch/sketch-core'
import { Viewport } from '../src/client/render.ts'
import { formatReadout, pickReadout } from '../src/client/readout.ts'

const WIDTH = 620
const HEIGHT = 380

/** A fitted window over x in [-2pi, 2pi], y in [-2, 2]. */
function viewport(): Viewport {
  return new Viewport(-2 * Math.PI, 2 * Math.PI, -2, 2).fit(WIDTH, HEIGHT)
}

/** One compiled curve with a colour. */
function curve(expr: string, color = '#378ADD') {
  return { fn: build(expr).eval, color }
}

describe('Viewport inverse mapping', () => {
  it('round-trips both axes', () => {
    const vp = viewport()
    for (const x of [-6.28, -1, 0, 2.5, 6.28]) expect(vp.xAt(vp.px(x))).toBeCloseTo(x)
    for (const y of [-1.9, -0.5, 0, 1.2]) expect(vp.yAt(vp.py(y))).toBeCloseTo(y)
  })
})

describe('pickReadout', () => {
  it('traces the curve at the cursor column without making the user aim', () => {
    const vp = viewport()
    const picked = pickReadout({
      px: vp.px(Math.PI / 2), py: vp.py(0), vp, curves: [curve('sin(x)')], values: {},
    })
    expect(picked).not.toBeNull()
    expect(picked!.x).toBeCloseTo(Math.PI / 2)
    expect(picked!.y).toBeCloseTo(1)
    expect(picked!.color).toBe('#378ADD')
  })

  it('chooses the vertically nearer curve', () => {
    const vp = viewport()
    const x = Math.PI / 2
    // At x = pi/2, sin is 1 and cos is 0, so a cursor near y = 0 must pick cos.
    const picked = pickReadout({
      px: vp.px(x), py: vp.py(0.05), vp,
      curves: [curve('sin(x)', '#378ADD'), curve('cos(x)', '#D9822B')], values: {},
    })
    expect(picked!.color).toBe('#D9822B')
    expect(picked!.y).toBeCloseTo(0)
  })

  it('declines when the cursor is outside the plot', () => {
    const vp = viewport()
    expect(pickReadout({ px: vp.width + 4, py: 40, vp, curves: [curve('sin(x)')], values: {} })).toBeNull()
    expect(pickReadout({ px: 40, py: -1, vp, curves: [curve('sin(x)')], values: {} })).toBeNull()
  })

  it('skips a curve with no value at this x instead of reporting garbage', () => {
    const vp = viewport()
    const picked = pickReadout({
      px: vp.px(-1), py: vp.py(0), vp, curves: [curve('log(x)')], values: {},
    })
    expect(picked).toBeNull()
  })

  it('substitutes the live parameter values into the evaluation', () => {
    const vp = viewport()
    const picked = pickReadout({
      px: vp.px(Math.PI / 2), py: vp.py(0), vp, curves: [curve('A*sin(x)')], values: { A: 3 },
    })
    expect(picked!.y).toBeCloseTo(3)
  })

  it('declines when there is nothing to pick from', () => {
    const vp = viewport()
    expect(pickReadout({ px: 10, py: 10, vp, curves: [], values: {} })).toBeNull()
  })
})

describe('formatReadout', () => {
  it('keeps three decimals for ordinary magnitudes and trims trailing zeros', () => {
    expect(formatReadout(1.23456)).toBe('1.235')
    expect(formatReadout(2)).toBe('2')
    expect(formatReadout(-0.5)).toBe('-0.5')
  })

  it('switches to significant form at the extremes instead of printing a wall of digits', () => {
    expect(formatReadout(123456)).toBe('1.23e+5')
    expect(formatReadout(0.000123)).toBe('1.23e-4')
  })

  it('names the non-finite cases verbatim rather than inventing a number', () => {
    expect(formatReadout(Number.NaN)).toBe('NaN')
    expect(formatReadout(Number.POSITIVE_INFINITY)).toBe('∞')
    expect(formatReadout(Number.NEGATIVE_INFINITY)).toBe('-∞')
  })
})
