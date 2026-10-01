/**
 * Compaction policy tests.
 *
 * The policy exists so plot specs can live in conversation history without
 * making the session grow linearly: three representation levels, demoted in
 * bands as turns age.
 */
import { describe, expect, it } from 'vitest'

import {
  compact,
  toSummary,
  toReference,
  applyEdit,
  describe as describeSpec,
  kindOf,
  estimateTokens,
  isReference,
  isSummary,
  LEVEL,
} from '../src/compact.ts'
import type { SketchSpec, ParamSpec } from '../src/compact.ts'

/** Build a full spec for a parameterised sine wave. */
function sineSpec(): SketchSpec {
  return {
    expr: 'A*sin(w*x+p)',
    params: { A: [0.2, 2, 1], w: [0.5, 4, 1], p: [0, 6.283, 0] },
  }
}

/** Read a parameter tuple, asserting it is present. */
function param(spec: SketchSpec, name: string): ParamSpec {
  const found = spec.params?.[name]
  if (found === undefined) throw new Error(`missing parameter ${name}`)
  return found
}

describe('compaction levels', () => {
  it('toSummary keeps expr and mode, drops params and range', () => {
    const s = toSummary({ ...sineSpec(), mode: 'tangent', range: { x: [-3, 3] } })
    expect(s).toEqual({ expr: 'A*sin(w*x+p)', mode: 'tangent' })
    expect(isSummary(s)).toBe(true)
  })

  it('toSummary omits the default mode', () => {
    expect(toSummary({ ...sineSpec(), mode: 'plain' })).toEqual({ expr: 'A*sin(w*x+p)' })
  })

  it('levels are ordered richest to cheapest', () => {
    const full = estimateTokens(sineSpec())
    const l2 = estimateTokens(toSummary(sineSpec()))
    const l3 = estimateTokens(toReference(sineSpec(), 'r'))
    expect([LEVEL.FULL, LEVEL.SUMMARY, LEVEL.REFERENCE].length).toBe(3)
    expect(full, `expected full>L2>L3, got ${full}/${l2}/${l3}`).toBeGreaterThan(l2)
    expect(l2).toBeGreaterThan(l3)
  })

  it('a reference carries no copy of the expression', () => {
    const ref = toReference(sineSpec(), 'r1')
    expect(Array.isArray(ref)).toBe(true)
    expect(ref).toEqual(['r1', 'curve'])
    expect(JSON.stringify(ref).includes('sin')).toBe(false)
  })

  it('classifies each sketch family', () => {
    expect(kindOf({ expr: 'x^2' })).toBe('curve')
    expect(kindOf({ expr: 'x^2', mode: 'tangent' })).toBe('tangent')
    expect(kindOf({ expr: 'x^2', mode: 'riemann' })).toBe('area')
    expect(kindOf({ expr: 'sin(x)', mode: 'taylor' })).toBe('series')
    expect(kindOf({ expr: 'x', data: 'sales' })).toBe('data')
  })

  it('renders a readable label', () => {
    expect(describeSpec({ expr: 'x^2' })).toBe('x^2')
    expect(describeSpec({ expr: 'x^2', mode: 'tangent' })).toBe('x^2 (tangent)')
  })
})

describe('compaction policy', () => {
  it('recent turns keep their full specs', () => {
    const turns = [{ specs: [sineSpec()] }, { specs: [sineSpec()] }]
    const out = compact(turns, { keepTurns: 3 })
    expect(param(out[0]!.specs[0] as SketchSpec, 'A')).toEqual([0.2, 2, 1])
  })

  it('older turns are demoted to references', () => {
    const turns = Array.from({ length: 4 }, () => ({ specs: [sineSpec()] }))
    const out = compact(turns, { keepTurns: 2 })
    expect(isReference(out[0]!.specs[0]!)).toBe(true)
    expect(isReference(out[1]!.specs[0]!)).toBe(true)
    expect(param(out[3]!.specs[0] as SketchSpec, 'A')).toEqual([0.2, 2, 1])
  })

  it('only the last sketch in a recent turn keeps full detail', () => {
    const turns = [{ specs: [sineSpec(), sineSpec(), sineSpec()] }]
    const out = compact(turns, { keepTurns: 1, fullPerTurn: 1 })
    expect(isSummary(out[0]!.specs[0]!)).toBe(true)
    expect(isSummary(out[0]!.specs[1]!)).toBe(true)
    expect(param(out[0]!.specs[2] as SketchSpec, 'A')).toEqual([0.2, 2, 1])
  })

  it('does not mutate the input', () => {
    const turns = [{ specs: [sineSpec()] }, { specs: [sineSpec()] }]
    const snapshot = JSON.stringify(turns)
    compact(turns, { keepTurns: 1 })
    expect(JSON.stringify(turns)).toBe(snapshot)
  })

  it('drops sketches beyond the forget horizon entirely', () => {
    const turns = Array.from({ length: 20 }, () => ({ specs: [sineSpec()] }))
    const out = compact(turns, { keepTurns: 2, forgetAfterTurns: 5 })
    expect(out[0]!.specs.length).toBe(0)
    expect(out[19]!.specs.length).toBe(1)
  })
})

describe('compaction economics', () => {
  it('demotion cuts token cost substantially', () => {
    const full = estimateTokens(sineSpec())
    const summary = estimateTokens(toSummary(sineSpec()))
    const reference = estimateTokens(toReference(sineSpec(), 'r1'))
    expect(summary).toBeLessThan(full)
    expect(reference).toBeLessThan(summary)
  })

  it('a long session stays near-constant in cost', () => {
    const spec = sineSpec()
    // Simulate 20 turns, 3 sketches each.
    const turns = Array.from({ length: 20 }, () => ({ specs: [spec, spec, spec] }))
    const compacted = compact(turns, { keepTurns: 3, fullPerTurn: 1 })
    const cost = compacted.flatMap((t) => t.specs).reduce((n, s) => n + estimateTokens(s), 0)
    const uncompacted = turns.flatMap((t) => t.specs).reduce((n, s) => n + estimateTokens(s), 0)
    // Measured at 9.1x (1200 -> 132) with these settings.
    expect(cost, `expected >6x saving, got ${uncompacted} -> ${cost}`).toBeLessThan(uncompacted / 6)
    expect(cost, `cost should stay under 150 tokens, got ${cost}`).toBeLessThan(150)
  })

  it('cost plateaus instead of growing with session length', () => {
    const spec = sineSpec()
    const costOf = (n: number): number => {
      const turns = Array.from({ length: n }, () => ({ specs: [spec, spec, spec] }))
      return compact(turns, { keepTurns: 3, forgetAfterTurns: 6 })
        .flatMap((t) => t.specs)
        .reduce((sum, s) => sum + estimateTokens(s), 0)
    }
    const at20 = costOf(20)
    const at60 = costOf(60)
    expect(at20).toBe(at60)
  })
})

describe('follow-up edits', () => {
  it('replaces the expression', () => {
    const { spec, changed } = applyEdit(sineSpec(), '把上图改成 sin(2x)')
    expect(spec.expr).toBe('sin(2x)')
    expect(spec.params).toBeUndefined()
    expect(changed).toEqual(['expr'])
  })

  it('sets a named parameter', () => {
    const { spec, changed } = applyEdit(sineSpec(), '把 A 改成 1.5')
    expect(param(spec, 'A')).toEqual([0.2, 2, 1.5])
    expect(param(spec, 'w')).toEqual([0.5, 4, 1])
    expect(changed).toEqual(['param:A'])
  })

  it('works on a summary-only spec by introducing the parameter', () => {
    const { spec, changed } = applyEdit({ expr: 'x^2' }, '把 k 改成 3')
    expect(param(spec, 'k')).toEqual([-6, 6, 3])
    expect(changed).toEqual(['param:k'])
  })

  it('sets an explicit range', () => {
    const { spec, changed } = applyEdit(sineSpec(), '把范围改成 [-5,5]')
    expect(spec.range?.x).toEqual([-5, 5])
    expect(changed).toEqual(['range'])
  })

  it('leaves prose alone', () => {
    const { changed } = applyEdit(sineSpec(), '把这张图改成我想要的那种感觉')
    expect(changed).toEqual([])
  })

  it('does not mutate the previous spec', () => {
    const prev = sineSpec()
    const snapshot = JSON.stringify(prev)
    applyEdit(prev, '把 A 改成 1.5')
    expect(JSON.stringify(prev)).toBe(snapshot)
  })
})
