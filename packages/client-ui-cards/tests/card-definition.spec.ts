/**
 * `card` node projection.
 *
 * The projection is the whole reason this channel is replay-safe: it reads the
 * card out of the persisted `tool/call` arguments, so these tests drive
 * synthetic events through `match`/`start`/`buildViewNode` exactly as the
 * assembler does and assert the node it publishes.
 *
 * The wire shape matters and is pinned here: a `tool/call` event carries its
 * arguments as the model-produced JSON **text**, not a parsed object. Driving
 * these tests with an object is what let a live run hand every card to the raw
 * fallback while every unit test stayed green.
 */
import { describe, expect, it } from 'vitest'
import { CARD_TOOL_NAME } from '@aisketch/cards-core'
import { CARD_NODE_KIND, cardDefinition } from '../src/client/card-definition.ts'

type SessionEventLike = Parameters<typeof cardDefinition.match>[0]
type StartMatch = Parameters<typeof cardDefinition.start>[1]
type NodeContext = Parameters<NonNullable<typeof cardDefinition.buildViewNode>>[0]

/** One unresolved location, matching what an early call resolves to. */
const location = { kind: 'unresolved' } as const

/** A synthetic session event. */
function event(type: string, seq: number, data: Record<string, unknown>): SessionEventLike {
  return { type, seq, time: seq, data } as unknown as SessionEventLike
}

/** A synthetic `tool/call` carrying arguments the way the event does: as JSON text. */
function callEvent(args: unknown, seq = 7, name: string = CARD_TOOL_NAME): SessionEventLike {
  return event('tool/call', seq, { name, callId: 'call-1', turn: 1, arguments: JSON.stringify(args) })
}

/** A synthetic `tool/call` whose `arguments` are already an object. */
function objectCallEvent(args: unknown, seq = 7): SessionEventLike {
  return event('tool/call', seq, { name: CARD_TOOL_NAME, callId: 'call-1', turn: 1, arguments: args })
}

/**
 * Project one call end to end, the way the assembler would.
 * @param source - the call event to project.
 * @returns the published node, or null when the definition declines the event.
 */
function project(source: SessionEventLike) {
  if (cardDefinition.match(source) === null) return null
  const match = { event: source, role: 'start', location } as unknown as StartMatch
  const context = {
    key: 'cards:1', kind: 'cards', id: 'call-1', matches: [match], start: match, current: new Map(),
  } as unknown as NodeContext
  const state = cardDefinition.start(context as never, match, {} as never)
  const build = cardDefinition.buildViewNode
  if (build === undefined) throw new Error('the card definition must publish a view node')
  return build({ ...context, state } as never)
}

const tableArgs = {
  kind: 'table',
  title: '月度收入',
  payload: { columns: ['月份', '收入'], rows: [['1月', 120], ['2月', 130]] },
}

describe('matching', () => {
  it('claims a show_card call and keys it on the call id', () => {
    expect(cardDefinition.match(callEvent(tableArgs))).toEqual({ id: 'call-1', role: 'start' })
  })

  it('leaves every other tool and phase alone', () => {
    expect(cardDefinition.match(callEvent(tableArgs, 7, 'sketch_function'))).toBeNull()
    expect(cardDefinition.match(event('tool/result', 8, { name: CARD_TOOL_NAME, callId: 'call-1' }))).toBeNull()
    expect(cardDefinition.match(event('turn/start', 1, { turn: 1 }))).toBeNull()
  })
})

describe('the published node', () => {
  it('is a card node anchored just above the call that produced it', () => {
    const node = project(callEvent(tableArgs))
    expect(node).toMatchObject({
      kind: CARD_NODE_KIND,
      target: 'chat',
      id: 'call-1',
      visibility: 'visible',
      anchorSeq: 6.9,
    })
    expect(node?.data).toMatchObject({ card: { version: 1, kind: 'table', title: '月度收入' } })
  })

  it('parses the JSON text the event actually carries', () => {
    const node = project(callEvent({ kind: 'note', payload: { text: 'hi' } }))
    expect(node?.data).toMatchObject({ card: { version: 1, kind: 'note' } })
  })

  it('also accepts an already-parsed argument object', () => {
    expect(project(objectCallEvent(tableArgs))?.data).toMatchObject({ card: { kind: 'table' } })
  })

  it('keeps a malformed envelope visible as data instead of an escaped string', () => {
    const node = project(callEvent({ kind: '../escape', payload: {} }))
    expect(node).not.toBeNull()
    expect(node?.data).toMatchObject({ card: null, raw: { kind: '../escape', payload: {} } })
  })

  it('keeps unparseable argument text visible verbatim', () => {
    const node = project(event('tool/call', 7, { name: CARD_TOOL_NAME, callId: 'call-1', turn: 1, arguments: '{' }))
    expect(node).not.toBeNull()
    expect(node?.data).toMatchObject({ card: null, raw: '{' })
  })

  it('keeps an unknown kind, so a newer renderer can still claim the node', () => {
    const node = project(callEvent({ kind: 'school.timetable', payload: { slots: [] } }))
    expect(node?.data).toMatchObject({ card: { kind: 'school.timetable' } })
  })

  it('publishes no card for a private drawing draft', () => {
    const node = project(callEvent({
      kind: 'draw',
      draft: true,
      payload: { elements: [{ type: 'path', d: 'M 0 0 L 10 10' }] },
    }))
    expect(node).toBeNull()
  })

  it('publishes the final call, where draft is false or omitted', () => {
    const node = project(callEvent({
      kind: 'draw',
      draft: false,
      payload: { elements: [{ type: 'path', d: 'M 0 0 L 10 10' }] },
    }))
    expect(node?.data).toMatchObject({ card: { kind: 'draw' } })
  })

  it('replays from the persisted argument text a reload hands back', () => {
    // The Host logs the model arguments as JSON text, so a replay feeds these
    // exact bytes through the same parse the live call took.
    const persisted = JSON.stringify(tableArgs)
    const node = project(event('tool/call', 7, { name: CARD_TOOL_NAME, callId: 'call-1', turn: 1, arguments: persisted }))
    expect(node?.data).toMatchObject({ card: { kind: 'table', payload: { columns: ['月份', '收入'] } } })
  })

  it('publishes nothing while the definition has no state', () => {
    const build = cardDefinition.buildViewNode
    if (build === undefined) throw new Error('the card definition must publish a view node')
    const context = { key: 'cards:1', kind: 'cards', id: 'call-1', matches: [], current: new Map() } as unknown as NodeContext
    expect(build(context as never)).toBeNull()
  })
})