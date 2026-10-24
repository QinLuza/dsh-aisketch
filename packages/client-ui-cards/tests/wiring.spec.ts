/**
 * Plugin wiring.
 *
 * This channel's failure mode is structural, not logical: the `card` node was
 * registered without a completed-Turn tail, so a finished Turn folded the card
 * away and the answer lost its table -- while unit tests over either half stayed
 * green. Nothing in the halves could fail, because the missing half was missing.
 *
 * So this spec drives the real `apply()` against a stub context and pins the
 * registration set itself: both faces of the channel, both accumulated node
 * kinds, and the service dependencies the body reads. Adding a face without its
 * companion, or dropping a service from `inject` (which leaves the Cordis fiber
 * in `loading` with no visible exception), fails here first.
 */
import { describe, expect, it } from 'vitest'
import { apply, CARD_RENDERER_ID, inject } from '../src/client/index.ts'
import { cardRendererKinds } from '../src/client/registry.ts'

/** Everything one `apply()` run registered, by kind. */
interface Wiring {
  readonly effects: readonly string[]
  readonly dictionaries: readonly string[]
  readonly eventKinds: readonly string[]
  readonly injectedSlots: readonly string[]
  readonly registeredSlots: readonly string[]
  readonly rendererKinds: readonly string[]
}

/** A stub client context that records every registration instead of performing it. */
function wire(): Wiring {
  const effects: string[] = []
  const dictionaries: string[] = []
  const eventKinds: string[] = []
  const injectedSlots: string[] = []
  const registeredSlots: string[] = []
  const ctx = {
    effect: (run: () => unknown, label: string) => {
      effects.push(label)
      const dispose = run()
      return typeof dispose === 'function' ? dispose : () => {}
    },
    locale: {
      register: (namespace: string) => {
        dictionaries.push(namespace)
        return () => {}
      },
    },
    uiConversation: {
      events: {
        register: (definition: { readonly kind: string }) => {
          eventKinds.push(definition.kind)
          return () => {}
        },
      },
    },
    slots: {
      inject: (name: string, run: () => unknown) => {
        injectedSlots.push(name)
        run()
        return () => {}
      },
      register: (options: { readonly name: string; readonly key?: string; readonly id?: string }) => {
        registeredSlots.push(`${options.name}/${options.key ?? options.id ?? '?'}`)
        return () => {}
      },
    },
  }
  apply(ctx as never)
  // The renderer claim goes through the module-level registry, so this reads the
  // real map rather than a recording of the call.
  return { effects, dictionaries, eventKinds, injectedSlots, registeredSlots, rendererKinds: cardRendererKinds() }
}

describe('the channel registers both faces', () => {
  it('puts a card where the call was made and again where the fold cannot reach', () => {
    const wiring = wire()
    expect(wiring.registeredSlots).toContain('conversation.chat.node/card')
    expect(wiring.registeredSlots).toContain(`conversation.chat.turnTail/${CARD_RENDERER_ID}`)
  })

  it('waits on the slot declarations it contributes into', () => {
    const wiring = wire()
    expect(wiring.injectedSlots).toEqual(['conversation.chat.node', 'conversation.chat.turnTail'])
  })
})

describe('the projection and its accumulator', () => {
  it('registers one node kind per call and one turn accumulator per conversation', () => {
    const wiring = wire()
    expect(wiring.eventKinds).toEqual(['cards', 'card-tail'])
  })
})

describe('the service gate', () => {
  it('declares every service the body reads', () => {
    // Missing any of these leaves the fiber in `loading` forever: the shell
    // reports "Failed to load plugins" and the real exception is only a log line.
    expect([...inject].sort()).toEqual(['locale', 'slots', 'uiConversation'])
  })

  it('registers its dictionaries and its shipped renderers as effects', () => {
    const wiring = wire()
    expect(wiring.dictionaries).toEqual(['cards'])
    expect(wiring.effects).toEqual([
      'client-ui-cards: dictionaries',
      'client-ui-cards: table renderer',
      'client-ui-cards: flowchart renderer',
      'client-ui-cards: draw renderer',
      'client-ui-cards: figure renderer',
    ])
    // A kind without its claim is invisible: the card would reach the page and
    // render as raw data, which is exactly the failure this list catches.
    expect(wiring.rendererKinds).toContain('table')
    expect(wiring.rendererKinds).toContain('flowchart')
    expect(wiring.rendererKinds).toContain('draw')
    expect(wiring.rendererKinds).toContain('figure')
  })
})
