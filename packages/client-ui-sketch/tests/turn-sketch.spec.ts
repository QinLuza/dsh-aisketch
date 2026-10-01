/**
 * Turn-scoped sketch artifacts Definition.
 *
 * The Definition is the reason the plot survives the Turn-process fold: it
 * publishes the turn's specs as Turn Location data, which the completed-Turn
 * tail reads. Those specs come from the persisted `presentationMeta` of the
 * `sketch_function` result -- the same bytes the toolview card reads -- so a
 * replayed session yields an identical list.
 *
 * The wire shape matters and is pinned here: `tool/result` carries the result
 * metadata at `event.data.meta`, while the tool name only rides the paired
 * `tool/call`, which is why the state records calls before they settle.
 */
import { describe, expect, it } from 'vitest'
import { sketchTurnDefinition, selectSketchTurn } from '../src/client/turn-sketch.ts'

type EventLike = Parameters<typeof sketchTurnDefinition.match>[0]
type StartMatch = Parameters<typeof sketchTurnDefinition.start>[1]
type Match = Parameters<typeof sketchTurnDefinition.update>[1]
type State = ReturnType<typeof sketchTurnDefinition.start>
type LocationContext = NonNullable<Parameters<typeof sketchTurnDefinition.buildLocationData>>[0]
type Published = NonNullable<ReturnType<NonNullable<typeof sketchTurnDefinition.buildLocationData>>>

const location = { kind: 'unresolved' } as const

function event(type: string, seq: number, data: Record<string, unknown>): EventLike {
  return { type, seq, time: seq, data } as unknown as EventLike
}

/** A `tool/call` for one tool name and call id. */
function callEvent(name: string, callId: string, seq: number): EventLike {
  return event('tool/call', seq, { name, callId, turn: 1, arguments: '{}' })
}

/** A `tool/result` whose metadata holds a plot spec, the way the Host publishes it. */
function resultEvent(callId: string, seq: number, meta: unknown, isError = false): EventLike {
  return event('tool/result', seq, {
    turn: 1,
    meta,
    message: { source: { callId }, isError, content: [] },
  })
}

const spec = { expr: 'sin(x)', mode: 'plain' }

/**
 * Replay one turn's events through the Definition the way the engine does.
 * @param events - session events in ascending sequence.
 * @returns the specs the turn publishes, empty when it drew nothing.
 */
function replay(events: readonly EventLike[]): readonly unknown[] {
  let state: State | undefined
  for (const source of events) {
    const matched = sketchTurnDefinition.match(source)
    if (matched === null) continue
    const match = { event: source, role: matched.role, location } as unknown as Match
    if (state === undefined) {
      if (matched.role !== 'start') throw new Error('the first accepted event must start the Context')
      state = sketchTurnDefinition.start({ matches: [match] } as never, match as StartMatch, {} as never)
      continue
    }
    state = sketchTurnDefinition.update({ matches: [match], state } as never, match)
  }
  const published = sketchTurnDefinition.buildLocationData?.(
    { state, matches: [] } as unknown as LocationContext, 'turn', undefined,
  )
  if (published === null || published === undefined) return []
  const value = published as Extract<Published, { kind: 'turn' }>
  return value.value.sketches
}

describe('sketchTurnDefinition', () => {
  it('collects the spec of every successful sketch_function result in call order', () => {
    expect(replay([
      event('turn/start', 1, { turn: 1 }),
      callEvent('sketch_function', 'a', 2),
      resultEvent('a', 3, { spec }),
      callEvent('sketch_function', 'b', 4),
      resultEvent('b', 5, { spec: { expr: 'cos(x)' } }),
    ])).toEqual([
      { callId: 'a', seq: 3, spec: { expr: 'sin(x)', mode: 'plain' } },
      { callId: 'b', seq: 5, spec: { expr: 'cos(x)' } },
    ])
  })

  it('ignores other tools, failed results, and results without a usable spec', () => {
    expect(replay([
      event('turn/start', 1, { turn: 1 }),
      callEvent('write', 'w', 2),
      resultEvent('w', 3, { spec }),
      callEvent('sketch_function', 'bad', 4),
      resultEvent('bad', 5, undefined),
      callEvent('sketch_function', 'err', 6),
      resultEvent('err', 7, { spec }, true),
      callEvent('sketch_function', 'nospec', 8),
      resultEvent('nospec', 9, { summary: 'nothing' }),
    ])).toEqual([])
  })

  it('replaces a second result for the same call instead of drawing it twice', () => {
    expect(replay([
      event('turn/start', 1, { turn: 1 }),
      callEvent('sketch_function', 'a', 2),
      resultEvent('a', 3, { spec: { expr: 'sin(x)' } }),
      resultEvent('a', 6, { spec: { expr: 'cos(x)' } }),
    ])).toEqual([{ callId: 'a', seq: 6, spec: { expr: 'cos(x)' } }])
  })

  it('keeps the previous publication while nothing moved', () => {
    const events = [
      event('turn/start', 1, { turn: 1 }),
      callEvent('sketch_function', 'a', 2),
      resultEvent('a', 3, { spec }),
    ]
    let state: State | undefined
    for (const source of events) {
      const matched = sketchTurnDefinition.match(source)
      if (matched === null) continue
      const match = { event: source, role: matched.role, location } as unknown as Match
      state = state === undefined
        ? sketchTurnDefinition.start({ matches: [match] } as never, match as StartMatch, {} as never)
        : sketchTurnDefinition.update({ matches: [match], state } as never, match)
    }
    const context = { state, matches: [] } as unknown as LocationContext
    const build = sketchTurnDefinition.buildLocationData
    if (build === undefined) throw new Error('the sketch definition must publish turn data')
    const first = build(context, 'turn', undefined)
    expect(build(context, 'turn', first)).toBe(first)
  })
})

describe('selectSketchTurn', () => {
  /** Drive the selector over one turn data map and a closing sequence. */
  function select(sketches: readonly unknown[], seq: number): readonly unknown[] | null {
    const data = sketches.length === 0
      ? undefined
      : { sketches }
    const owner = {
      turn: { data: { get: (key: string) => key === 'sketch' ? data : undefined } },
      seq,
      openFile: () => {},
    } as never
    return selectSketchTurn(owner)
  }

  it('keeps only the plots settled before the closing reply', () => {
    expect(select([{ callId: 'a', seq: 3, spec }, { callId: 'b', seq: 9, spec }], 5))
      .toEqual([{ callId: 'a', seq: 3, spec }])
  })

  it('declines a turn that drew nothing', () => {
    expect(select([], 5)).toBeNull()
    expect(select([{ callId: 'a', seq: 7, spec }], 5)).toBeNull()
  })
})
