/**
 * Renderer registry semantics.
 *
 * These are the rules a third-party card depends on: claiming a kind, being
 * idempotent when the same plugin is re-applied, and failing loudly when two
 * registrants claim one kind. Each case uses its own kind because the registry
 * is module-level state shared by the whole test file.
 */
import type { ComponentType } from 'react'
import { describe, expect, it } from 'vitest'
import {
  cardRenderer, cardRendererKinds, cardRendererVersion,
  registerCardRenderer, subscribeCardRenderers,
} from '../src/client/registry.ts'
import type { CardRendererProps } from '../src/client/registry.ts'

/** A renderer that draws nothing; the registry never inspects it. */
const noop = (() => null) as unknown as ComponentType<CardRendererProps>

describe('card renderer registry', () => {
  it('claims a kind and reports it', () => {
    const dispose = registerCardRenderer('claim', { id: 'a', trust: 'native', component: noop })
    expect(cardRenderer('claim')).toMatchObject({ id: 'a', trust: 'native' })
    expect(cardRendererKinds()).toContain('claim')
    dispose()
    expect(cardRenderer('claim')).toBeUndefined()
  })

  it('is idempotent for the same registrant, and the repeat disposer keeps the claim', () => {
    const first = registerCardRenderer('idempotent', { id: 'a', trust: 'native', component: noop })
    const repeat = registerCardRenderer('idempotent', { id: 'a', trust: 'native', component: noop })
    repeat()
    expect(cardRenderer('idempotent')).toBeDefined()
    first()
    expect(cardRenderer('idempotent')).toBeUndefined()
  })

  it('refuses a second registrant claiming an occupied kind', () => {
    const dispose = registerCardRenderer('conflict', { id: 'a', trust: 'native', component: noop })
    expect(() => registerCardRenderer('conflict', { id: 'b', trust: 'native', component: noop }))
      .toThrow(/already registered by a/)
    dispose()
  })

  it('releases a kind so another registrant can claim it, and tolerates a double dispose', () => {
    const dispose = registerCardRenderer('release', { id: 'a', trust: 'native', component: noop })
    dispose()
    dispose()
    expect(() => registerCardRenderer('release', { id: 'b', trust: 'sandboxed', component: noop })).not.toThrow()
    expect(cardRenderer('release')).toMatchObject({ id: 'b', trust: 'sandboxed' })
  })

  it.each(['', '../escape', '9lives', 'a'.repeat(65), 'two words'])('refuses the malformed kind %j', (kind) => {
    expect(() => registerCardRenderer(kind, { id: 'a', trust: 'native', component: noop })).toThrow(/not a valid kind/)
  })

  it('publishes claims and releases, which is how a late plugin adopts a card already on screen', () => {
    const seen: number[] = []
    const unsubscribe = subscribeCardRenderers(() => seen.push(cardRendererVersion()))
    const before = cardRendererVersion()
    registerCardRenderer('published', { id: 'a', trust: 'native', component: noop })()
    unsubscribe()
    registerCardRenderer('published', { id: 'a', trust: 'native', component: noop })()
    expect(seen).toEqual([before + 1, before + 2])
  })
})

describe('trust grade', () => {
  it('is carried on the entry, so a deployment can forbid one grade without touching cards', () => {
    const dispose = registerCardRenderer('html', { id: 'third-party', trust: 'sandboxed', component: noop })
    expect(cardRenderer('html')?.trust).toBe('sandboxed')
    dispose()
  })
})