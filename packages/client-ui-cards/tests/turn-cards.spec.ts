/**
 * Completed-Turn card accumulation.
 *
 * A `card` node lives inside the Turn's process and is folded away when the Turn
 * completes, so the tail reads this accumulation instead. These tests drive
 * synthetic events through `match`/`start`/`update`/`buildLocationData` the way
 * the assembler does, and through `selectCardsTurn` the way the tail does, so
 * the artifact channel is pinned rather than assumed.
 *
 * The wire shape matters here too: `tool/call` carries its arguments as the
 * model-produced JSON **text**, so a spec that only accepted an object would let
 * every card reach the tail as raw fallback while unit tests stayed green.
 */
import { describe, expect, it } from 'vitest'
import { CARD_TOOL_NAME } from '@gk/cards-core'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import { cardTurnDefinition, selectCardsTurn } from '../src/client/turn-cards.ts'

type SessionEventLike = Parameters<typeof cardTurnDefinition.match>[0]
type StartMatch = Parameters<typeof cardTurnDefinition.start>[1]
type UpdateMatch = Parameters<typeof cardTurnDefinition.update>[1]
type TurnState = ReturnType<typeof cardTurnDefinition.start>
type BuildContext = Parameters<NonNullable<typeof cardTurnDefinition.buildLocationData>>[0]

/** One unresolved location, matching what an early call resolves to. */
const location = { kind: 'unresolved' } as const

/** A synthetic session event. */
function event(type: string, seq: number, data: Record<string, unknown>): SessionEventLike {
  return { type, seq, time: seq, data } as unknown as SessionEventLike
}

/** A synthetic `tool/call` carrying arguments the way the event does: as JSON text. */
function callEvent(args: unknown, seq = 7, callId = 'call-1', name: string = CARD_TOOL_NAME): SessionEventLike {
  return event('tool/call', seq, { name, callId, turn: 1, arguments: JSON.stringify(args) })
}

/** Open a Turn the way `turn/start` does. */
function openTurn(): TurnState {
  const match = { event: event('turn/start', 1, { turn: 1 }), role: 'start', location } as unknown as StartMatch
  return cardTurnDefinition.start({} as never, match, {} as never)
}

/** Fold one more event into an open Turn. */
function fold(state: TurnState, source: SessionEventLike): TurnState {
  const match = { event: source, role: 'update', location } as unknown as UpdateMatch
  return cardTurnDefinition.update({ state } as never, match)
}

/** Publish one Turn's data the way the assembler would. */
function publish(state: TurnState, previous?: unknown) {
  const build = cardTurnDefinition.buildLocationData
  if (build === undefined) throw new Error('the card turn definition must publish location data')
  const context = { key: 'card-tail:1', kind: 'card-tail', id: '1', start: { location }, state } as unknown as BuildContext
  return build(context as never, 'turn' as never, previous as never)
}

/** A tail owner whose Turn carries these cards. */
function owner(cards: readonly unknown[], seq = 100): TurnTailOwnerProps {
  return { turn: { data: { get: () => ({ cards }) } }, seq } as unknown as TurnTailOwnerProps
}

/** The cards one publication carries, or null when it published something else. */
function publishedCards(state: TurnState): readonly unknown[] | null {
  const data = publish(state)
  if (data === null || data.kind !== 'turn' || data.key !== 'card-tail') return null
  return data.value.cards
}

const tableArgs = {
  kind: 'table',
  title: '月度收入',
  payload: { columns: ['月份', '收入'], rows: [['1月', 120]] },
}

describe('matching', () => {
  it('opens on turn/start and folds tool calls', () => {
    expect(cardTurnDefinition.match(event('turn/start', 1, { turn: 1 }))).toEqual({ id: '1', role: 'start' })
    expect(cardTurnDefinition.match(callEvent(tableArgs))).toEqual({ id: '1', role: 'update' })
  })

  it('leaves every other event alone', () => {
    expect(cardTurnDefinition.match(event('tool/result', 8, { turn: 1, name: CARD_TOOL_NAME }))).toBeNull()
    expect(cardTurnDefinition.match(event('assistant/delta', 9, { turn: 1 }))).toBeNull()
  })
})

describe('accumulation', () => {
  it('keeps every show_card call in call order', () => {
    let state = openTurn()
    state = fold(state, callEvent(tableArgs, 7, 'call-1'))
    state = fold(state, callEvent({ kind: 'table', title: '第二张', payload: { columns: ['a'], rows: [['b']] } }, 11, 'call-2'))
    expect(state.cards.map(entry => entry.seq)).toEqual([7, 11])
    expect(state.cards.map(entry => entry.card?.title)).toEqual(['月度收入', '第二张'])
  })

  it('ignores a call to any other tool', () => {
    let state = openTurn()
    state = fold(state, callEvent(tableArgs, 7, 'call-1', 'sketch_function'))
    expect(state.cards).toHaveLength(0)
  })

  it('replaces a redelivered call instead of drawing it twice', () => {
    let state = openTurn()
    state = fold(state, callEvent(tableArgs, 7, 'call-1'))
    state = fold(state, callEvent({ kind: 'table', title: '改写', payload: { columns: ['a'], rows: [['b']] } }, 7, 'call-1'))
    expect(state.cards).toHaveLength(1)
    expect(state.cards[0]?.card?.title).toBe('改写')
  })

  it('keeps unparseable argument text visible verbatim', () => {
    let state = openTurn()
    state = fold(state, event('tool/call', 7, { name: CARD_TOOL_NAME, callId: 'call-1', turn: 1, arguments: '{' }))
    expect(state.cards[0]).toMatchObject({ card: null, raw: '{' })
  })

  it('keeps a parsed-but-invalid envelope as data, not as an escaped string', () => {
    let state = openTurn()
    state = fold(state, callEvent({ kind: '../escape', payload: {} }))
    expect(state.cards[0]).toMatchObject({ card: null, raw: { kind: '../escape', payload: {} } })
  })
})

describe('the published turn data', () => {
  it('publishes nothing while the Turn showed no card', () => {
    expect(publish(openTurn())).toBeNull()
  })

  it('publishes the cards under the Definition-owned turn key', () => {
    const state = fold(openTurn(), callEvent(tableArgs))
    expect(publish(state)).toMatchObject({ kind: 'turn', turn: 1, key: 'card-tail' })
    expect(publishedCards(state)).toHaveLength(1)
  })

  it('never publishes under a key other than the Definition kind -- the assembler kills the entry otherwise', () => {
    const state = fold(openTurn(), callEvent(tableArgs))
    const data = publish(state)
    expect(data).not.toBeNull()
    expect(data?.key).toBe(cardTurnDefinition.kind)
  })

  it('reuses the previous publication when nothing changed', () => {
    const state = fold(openTurn(), callEvent(tableArgs))
    const first = publish(state)
    expect(publish(state, first)).toBe(first)
  })
})

describe('what the tail selects', () => {
  it('returns nothing when the Turn showed no card', () => {
    expect(selectCardsTurn(owner([]))).toBeNull()
  })

  it('keeps only the cards called before the closing reply', () => {
    const cards = [
      { callId: 'call-1', seq: 7, card: { version: 1, kind: 'table', payload: { columns: ['a'] } }, raw: {} },
      { callId: 'call-2', seq: 120, card: { version: 1, kind: 'table', payload: { columns: ['a'] } }, raw: {} },
    ]
    const selected = selectCardsTurn(owner(cards, 100))
    expect(selected?.map(entry => entry.callId)).toEqual(['call-1'])
  })
})
