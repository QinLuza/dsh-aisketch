/**
 * Snapshot plumbing: the two things that break when markup leaves the page.
 *
 * A `var(--token, fallback)` does not resolve inside an image document, and a
 * bitmap cache must not grow without bound. Both are pure functions, so they are
 * pinned here rather than in a browser.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { cachedSnapshot, clearSnapshots, resolveCssVariables, snapshotScale, storeSnapshot } from '../src/client/snapshot.ts'

describe('resolveCssVariables', () => {
  const tokens = new Map([['--dsw-alias-text-primary', '#e6e6e6']])
  const read = (name: string): string => tokens.get(name) ?? ''

  it('replaces a declared token with the live value', () => {
    expect(resolveCssVariables('fill="var(--dsw-alias-text-primary, #1f1f1f)"', read)).toBe('fill="#e6e6e6"')
  })

  it('keeps a fallback that contains parentheses when the token is undeclared', () => {
    const markup = '<path style="stroke:var(--dsw-alias-border-base, rgba(0, 0, 0, 0.12))"/>'
    expect(resolveCssVariables(markup, read)).toBe('<path style="stroke:rgba(0, 0, 0, 0.12)"/>')
  })

  it('leaves markup without variables untouched and handles several in one string', () => {
    expect(resolveCssVariables('<svg fill="#fff"/>', read)).toBe('<svg fill="#fff"/>')
    expect(resolveCssVariables('a var(--x, red) b var(--dsw-alias-text-primary, #000) c', read)).toBe('a red b #e6e6e6 c')
  })
})

describe('snapshotScale', () => {
  it('never goes below 1 and never above 2', () => {
    expect(snapshotScale(1200, 800, 1)).toBe(1)
    expect(snapshotScale(1200, 800, 3)).toBeCloseTo(1.5, 10)
  })

  it('caps the long edge at 1800 device pixels', () => {
    expect(snapshotScale(1600, 900, 2)).toBeCloseTo(1.125, 10)
    expect(snapshotScale(640, 400, 2)).toBe(2)
  })
})

describe('the bitmap cache', () => {
  beforeEach(() => clearSnapshots())

  it('returns what was stored and forgets everything on clear', () => {
    const canvas = { width: 10, height: 10 } as HTMLCanvasElement
    storeSnapshot('a', canvas)
    expect(cachedSnapshot('a')).toBe(canvas)
    clearSnapshots()
    expect(cachedSnapshot('a')).toBeUndefined()
  })

  it('evicts the oldest entry past the limit', () => {
    const canvases = Array.from({ length: 7 }, (_value, index) => ({ width: index, height: 1 }) as HTMLCanvasElement)
    for (let index = 0; index < canvases.length; index += 1) storeSnapshot(`k${index}`, canvases[index]!)
    expect(cachedSnapshot('k0')).toBeUndefined()
    expect(cachedSnapshot('k6')).toBe(canvases[6])
  })
})
