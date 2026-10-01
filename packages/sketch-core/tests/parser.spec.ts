/**
 * Parser conformance tests.
 *
 * The higher-order derivative cases at the bottom guard a real bug: nested
 * central differences lost all precision past order 4, so the 7th Taylor
 * coefficient of sin came out as ~4.13e3 instead of ~-2e-4.
 */
import { describe, expect, it } from 'vitest'

import {
  build,
  parse,
  ParseError,
  freeVariables,
  derivativeAt,
  nthDerivativeAt,
  taylorCoefficients,
  taylorEvaluator,
  integrate,
} from '../src/parser.ts'

/** k! as an exact integer for small k. */
function fact(k: number): number {
  let f = 1
  for (let i = 2; i <= k; i++) f *= i
  return f
}

/** Evaluate a single expression with the given scope. */
const val = (src: string, scope: Record<string, number> = { x: 0 }): number => build(src).eval(scope)

describe('parser', () => {
  it('basic arithmetic and precedence', () => {
    expect(val('1+2*3', {})).toBe(7)
    expect(val('(1+2)*3', {})).toBe(9)
    expect(val('2^3^2', {})).toBe(512)
    expect(val('-2^2', {})).toBe(-4)
    expect(val('10-2-3', {})).toBe(5)
    expect(val('8/4/2', {})).toBe(1)
  })

  it('implicit multiplication', () => {
    expect(val('2x', { x: 5 })).toBe(10)
    expect(val('3sin(0)', {})).toBe(0)
    expect(val('(x+1)(x-1)', { x: 3 })).toBe(8)
    expect(val('2pi', {})).toBe(2 * Math.PI)
    expect(val('4x^2', { x: 3 })).toBe(36)
  })

  it('functions and constants', () => {
    expect(val('sin(0)', {})).toBe(0)
    expect(Math.round(val('cos(0)', {}))).toBe(1)
    expect(val('sqrt(16)', {})).toBe(4)
    expect(val('log(e)', {})).toBe(1)
    expect(val('abs(-7)', {})).toBe(7)
    expect(val('pow(2,10)', {})).toBe(1024)
    expect(val('max(3,7,5)', {})).toBe(7)
    expect(val('hypot(3,4)', {})).toBe(5)
  })

  it('resolves variables and parameters', () => {
    expect(val('x^2', { x: 4 })).toBe(16)
    expect(val('A*sin(w*x)', { x: 1, A: 2, w: Math.PI / 2 })).toBe(2)
    expect(val('a+b*c', { a: 1, b: 2, c: 3 })).toBe(7)
  })

  it('separates x from parameters in freeVariables', () => {
    expect(freeVariables(parse('A*sin(w*x+p)'))).toEqual(['A', 'p', 'w', 'x'])
    expect(freeVariables(parse('x^2'))).toEqual(['x'])
    expect(freeVariables(parse('2*pi'))).toEqual([])
  })

  it('breaks the line on non-finite samples', () => {
    const pts = build('1/x').sample(-2, 2, 5, {})
    expect(pts.filter(([, y]) => y === null).length).toBeGreaterThanOrEqual(1)
  })

  it('samples with parameter values applied', () => {
    expect(build('A*x').sample(0, 2, 3, { A: 5 })).toEqual([
      [0, 0],
      [1, 5],
      [2, 10],
    ])
  })

  it('differentiates to analytic results', () => {
    const f = build('x^2')
    expect(Math.abs(derivativeAt(f.eval, 3) - 6)).toBeLessThan(1e-4)
    const g = build('sin(x)')
    expect(Math.abs(derivativeAt(g.eval, 0) - 1)).toBeLessThan(1e-4)
  })

  it('integrates to analytic results', () => {
    const f = build('x^2')
    expect(Math.abs(integrate(f.eval, 0, 2) - 8 / 3)).toBeLessThan(1e-6)
    const g = build('sin(x)')
    expect(Math.abs(integrate(g.eval, 0, Math.PI) - 2)).toBeLessThan(1e-6)
  })

  it('raises ParseError with an index for malformed input', () => {
    const bad = ['1+', '(1+2', 'sin(', '*3', 'x @ 2', '']
    for (const src of bad) {
      expect(() => parse(src), `expected ParseError for "${src}"`).toThrow(ParseError)
    }
  })

  it('rejects an unknown function at compile time', () => {
    expect(() => build('foo(2)').eval({})).toThrow(ParseError)
  })

  it('handles deep nesting', () => {
    const src = '('.repeat(50) + 'x' + ')'.repeat(50)
    expect(val(src, { x: 7 })).toBe(7)
  })
})

describe('higher-order derivatives and Taylor coefficients', () => {
  it('nthDerivativeAt is exact on polynomials up to order 5', () => {
    const { eval: fn } = build('x^5-2*x^3+x')
    const x = 1.3
    const exact = [
      x ** 5 - 2 * x ** 3 + x,
      5 * x ** 4 - 6 * x ** 2 + 1,
      20 * x ** 3 - 12 * x,
      60 * x ** 2 - 12,
      120 * x,
      120,
    ]
    exact.forEach((want, k) => {
      const got = nthDerivativeAt(fn, x, {}, k)
      expect(
        Math.abs(got - want),
        `d^${k}/dx^${k} = ${got}, expected ${want}`,
      ).toBeLessThan(Math.max(1e-8, Math.abs(want) * 1e-9))
    })
  })

  it('stays accurate at high order', () => {
    // sin^(2j)(0) = 0 and sin^(2j+1)(0) alternates +/-1, so coefficient k is
    // (-1)^j / k!. Order 7 previously came out as 4.13e3.
    const { eval: fn } = build('sin(x)')
    const coeffs = taylorCoefficients(fn, 0, {}, 7)
    const exact = [0, 1, 0, -1 / 6, 0, 1 / 120, 0, -1 / 5040]
    coeffs.forEach((got, k) => {
      expect(Math.abs(got - (exact[k] as number)), `coefficient ${k}: ${got}`).toBeLessThan(1e-6)
    })
  })

  it('taylorCoefficients reproduce 1/k! for exp', () => {
    const { eval: fn } = build('exp(x)')
    const coeffs = taylorCoefficients(fn, 0, {}, 6)
    coeffs.forEach((got, k) => {
      // Measured worst case is ~2e-9; 1e-7 leaves headroom while still catching
      // the old nested-difference failure by 11 orders of magnitude.
      expect(Math.abs(got - 1 / fact(k)), `coefficient ${k}: ${got}`).toBeLessThan(1e-7)
    })
  })

  it('taylorEvaluator improves with order', () => {
    const { eval: fn } = build('sin(x)')
    const at = (order: number): number => {
      const T = taylorEvaluator(taylorCoefficients(fn, 0, {}, order), 0)
      return Math.abs(Math.sin(0.8) - T(0.8))
    }
    const e3 = at(3)
    const e7 = at(7)
    expect(e7).toBeLessThan(e3)
    expect(e7).toBeLessThan(1e-6)
  })

  it('taylorCoefficients never returns non-finite values', () => {
    // A pole sits just outside the stencil; a naive implementation emits
    // Infinity for the higher derivatives and a broken polynomial.
    const { eval: fn } = build('1/(x-0.5)')
    const coeffs = taylorCoefficients(fn, 0, {}, 6)
    expect(coeffs.every(Number.isFinite), `got ${coeffs}`).toBe(true)
  })

  it('higher derivatives respect parameters', () => {
    const { eval: fn } = build('A*x^2')
    // d2/dx2 (A*x^2) = 2A
    expect(Math.abs(nthDerivativeAt(fn, 3, { A: 2.5 }, 2) - 5)).toBeLessThan(1e-8)
  })

  it('derivativeAt and nthDerivativeAt agree', () => {
    const { eval: fn } = build('A*sin(w*x+p)')
    const params = { A: 1.2, w: 2, p: 0.5 }
    const a = derivativeAt(fn, 1.1, params)
    const b = nthDerivativeAt(fn, 1.1, params, 1)
    expect(a).toBe(b)
    const analytic = params.A * params.w * Math.cos(params.w * 1.1 + params.p)
    expect(Math.abs(a - analytic)).toBeLessThan(1e-5)
  })
})
