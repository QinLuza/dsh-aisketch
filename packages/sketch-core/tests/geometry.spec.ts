/**
 * Geometry resolution tests, including the "moving axes" animation regression.
 *
 * The bug this guards: re-fitting the y-range on every frame of a parameter
 * sweep keeps the wave filling the same band on screen, so the animation looks
 * like the *axes* are moving while the curve stands still. Freezing the range
 * across the whole parameter box is the fix.
 *
 * The counter-example test is deliberate: it proves the per-frame behaviour
 * really does produce the illusion, so the frozen test cannot pass vacuously.
 */
import { describe, expect, it } from 'vitest'

import { build } from '../src/parser.ts'
import { autoRangeY, freezeYRange, resolveGeometry, resolveXRange, normalizeMode } from '../src/geometry.ts'
import type { SketchSpec } from '../src/compact.ts'

const X_MIN = -2 * Math.PI
const X_MAX = 2 * Math.PI

/** Peak |y| over a sample, ignoring nulls. */
function peakAbs(points: readonly (readonly [number, number | null])[]): number {
  let peak = 0
  for (const [, y] of points) {
    if (y !== null && Number.isFinite(y)) peak = Math.max(peak, Math.abs(y))
  }
  return peak
}

/** The exact sweep the animation runs for a plain mode at a given tick. */
function sweepTick(tick: number): Record<string, number> {
  const [min, max] = [0.2, 2]
  const mid = (min + max) / 2
  const amp = (max - min) / 2
  return { A: mid + amp * Math.sin(tick * 0.06), w: 1, p: 0 }
}

describe('resolveXRange', () => {
  it('honours an explicit range above every heuristic', () => {
    const spec: SketchSpec = { expr: 'sin(x)', range: { x: [-1, 1] } }
    expect(resolveXRange(spec, 'plain')).toEqual([-1, 1])
  })

  it('gives trig expressions a few full periods', () => {
    expect(resolveXRange({ expr: 'sin(x)' }, 'plain')).toEqual([-2 * Math.PI, 2 * Math.PI])
  })

  it('gives logs a positive-only window', () => {
    expect(resolveXRange({ expr: 'log(x)' }, 'plain')).toEqual([0.02, 6])
  })

  it('sharpens the window for taylor so a low-degree polynomial still fits', () => {
    const wide = resolveXRange({ expr: 'sin(x)' }, 'taylor', 1)
    const tight = resolveXRange({ expr: 'sin(x)' }, 'taylor', 9)
    expect(Math.abs(wide[1])).toBeLessThan(2 * Math.PI)
    expect(tight[1]).toBeGreaterThan(wide[1])
  })
})

describe('normalizeMode', () => {
  it('defaults to plain and rejects unknown strings', () => {
    expect(normalizeMode(undefined)).toBe('plain')
    expect(normalizeMode('nonsense')).toBe('plain')
    expect(normalizeMode('taylor')).toBe('taylor')
  })
})

describe('autoRangeY', () => {
  it('always returns a non-degenerate range', () => {
    const flat = autoRangeY([
      [0, 3],
      [1, 3],
    ])
    expect(flat.yMax).toBeGreaterThan(flat.yMin)
  })

  it('falls back to a default window when nothing is finite', () => {
    expect(autoRangeY([])).toEqual({ yMin: -5, yMax: 5 })
  })

  it('clips a lone spike so it cannot flatten everything else', () => {
    const points: (readonly [number, number | null])[] = []
    for (let i = 0; i < 100; i++) points.push([i, 1])
    points.push([50, 1e6])
    // One outlier in 101 samples is inside the 2% tail and gets trimmed.
    expect(autoRangeY(points).yMax).toBeLessThan(100)
  })
})

describe('animation y-range freeze', () => {
  it('contains every frame of an amplitude sweep', () => {
    const compiled = build('A*sin(w*x+p)')
    const specs = { A: [0.2, 2] as const, w: [1, 1] as const, p: [0, 0] as const }
    const start = { A: 1.1, w: 1, p: 0 }

    const frozen = freezeYRange(compiled, start, specs, [X_MIN, X_MAX])
    const frozenSpan = frozen.yMax - frozen.yMin

    for (let tick = 0; tick <= 200; tick++) {
      const params = sweepTick(tick)
      for (const [x, y] of compiled.sample(X_MIN, X_MAX, 900, params)) {
        if (y === null || !Number.isFinite(y)) continue
        expect(
          y >= frozen.yMin - 1e-9 && y <= frozen.yMax + 1e-9,
          `tick ${tick}: y=${y} at x=${x} escaped [${frozen.yMin}, ${frozen.yMax}]`,
        ).toBe(true)
      }
    }
  })

  it('lets the curve visibly grow and shrink inside the still frame', () => {
    const compiled = build('A*sin(w*x+p)')
    const specs = { A: [0.2, 2] as const, w: [1, 1] as const, p: [0, 0] as const }
    const frozen = freezeYRange(compiled, { A: 1.1, w: 1, p: 0 }, specs, [X_MIN, X_MAX])
    const frozenSpan = frozen.yMax - frozen.yMin

    const fractions: number[] = []
    for (let tick = 0; tick <= 200; tick++) {
      const pts = compiled.sample(X_MIN, X_MAX, 900, sweepTick(tick))
      fractions.push((2 * peakAbs(pts)) / frozenSpan)
    }
    const spread = Math.max(...fractions) - Math.min(...fractions)
    expect(
      spread,
      `wave should visibly grow/shrink; on-screen amplitude spread was only ${spread.toFixed(3)}`,
    ).toBeGreaterThan(0.4)
  })

  it('per-frame fitting is the bug: the span tracks the parameter', () => {
    // The counter-example that documents WHY freezing is needed. It must show a
    // near-constant on-screen amplitude — the illusion the user reported.
    const compiled = build('A*sin(x)')
    const fractions: number[] = []
    for (let A = 0.5; A <= 3.0001; A += 0.25) {
      const pts = compiled.sample(X_MIN, X_MAX, 900, { A })
      const local = autoRangeY(pts)
      fractions.push((2 * peakAbs(pts)) / (local.yMax - local.yMin))
    }
    const spread = Math.max(...fractions) - Math.min(...fractions)
    expect(
      spread,
      `unfrozen amplitude should look static (the bug), spread was ${spread.toFixed(3)}`,
    ).toBeLessThan(0.15)
  })

  it('fits normally when there is no parameter to sweep', () => {
    const compiled = build('sin(x)')
    const frozen = freezeYRange(compiled, {}, {}, [X_MIN, X_MAX])
    const plain = autoRangeY(compiled.sample(X_MIN, X_MAX, 900, {}))
    expect(frozen).toEqual(plain)
  })
})

describe('resolveGeometry', () => {
  it('reports the tangent slope and ordinate at the probe point', () => {
    const g = resolveGeometry({ expr: 'cos(x)', mode: 'tangent' }, { probe: 0 })
    expect(g.mode).toBe('tangent')
    expect(g.tangent?.x).toBe(0)
    expect(Math.abs((g.tangent?.y ?? 0) - 1)).toBeLessThan(1e-9)
    // d/dx cos(x) at 0 is -sin(0) = 0.
    expect(Math.abs(g.tangent?.slope ?? 1)).toBeLessThan(1e-6)
  })

  it('sums rectangles and compares them to the exact integral', () => {
    const g = resolveGeometry({ expr: 'sin(x)', mode: 'riemann' }, { a: 0, b: Math.PI, n: 15 })
    expect(g.riemann?.bars.length).toBe(15)
    // Both must approach 2; the finite sum is allowed to be off by the width.
    expect(Math.abs((g.riemann?.exact ?? 0) - 2)).toBeLessThan(1e-6)
    expect(Math.abs((g.riemann?.sum ?? 0) - 2)).toBeLessThan(0.1)
  })

  it('reproduces exact Taylor coefficients for sin at 0', () => {
    const g = resolveGeometry({ expr: 'sin(x)', mode: 'taylor' }, { center: 0, taylorOrder: 5 })
    const coeffs = g.taylor?.coefficients ?? []
    expect(coeffs.length).toBe(6)
    const exact = [0, 1, 0, -1 / 6, 0, 1 / 120]
    coeffs.forEach((got, k) => {
      expect(Math.abs(got - (exact[k] as number)), `coefficient ${k}: ${got}`).toBeLessThan(1e-6)
    })
  })

  it('draws one curve per comparison line and parses labels', () => {
    const g = resolveGeometry({
      expr: 'x^2',
      mode: 'compare',
      compare: ['抛物线, x^2', '直线, 2x'],
    })
    expect(g.curves.length).toBe(3)
    expect(g.curves[1]?.label).toBe('抛物线')
    expect(g.curves[2]?.expr).toBe('2x')
  })

  it('yields empty geometry instead of throwing on unparsable input', () => {
    const g = resolveGeometry({ expr: 'sin(' })
    expect(g.curves.length).toBe(0)
    expect(g.yRange.yMax).toBeGreaterThan(g.yRange.yMin)
  })

  it('applies parameter values to the drawn curve', () => {
    const g = resolveGeometry({ expr: 'A*x', params: { A: [1, 5, 3] } })
    const last = g.curves[0]?.points.at(-1)
    expect(last?.y).toBeCloseTo(3 * (last?.x ?? 0), 9)
  })

  it('holds a supplied frozen range instead of fitting one', () => {
    const g = resolveGeometry({ expr: 'A*sin(x)', params: { A: [0.2, 2, 0.2] } }, {
      frozenYRange: { yMin: -3, yMax: 3 },
    })
    expect(g.yRange).toEqual({ yMin: -3, yMax: 3 })
  })
})
