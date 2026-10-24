/**
 * Turn-scoped sketch plots, published as Turn Location data.
 *
 * A Tool call belongs to a Turn's process, and a normally completed Turn folds
 * its process rows behind the whole-Turn control (`foldCompletedTurns` in every
 * mode but `verbose`). A graph drawn for the answer is an artifact of that
 * answer, not process noise, so it goes through the channel the base reserves
 * for artifacts: this Definition accumulates the turn's specs and the
 * completed-Turn tail renders them where nothing folds.
 *
 * The source is the result's persisted `presentationMeta`, never the model's
 * arguments, so a replayed session lists the identical plots with no Host call.
 */
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { SketchSpec } from '@aisketch/sketch-core'
import { readSpec } from './spec.ts'

/** The wire name whose results carry a plot spec. */
const SKETCH_TOOL_NAME = 'sketch_function'

/** One plot settled during a Turn. */
export interface SketchEntry {
  readonly callId: string
  readonly seq: number
  readonly spec: SketchSpec
}

/** Immutable plot facts published against one Turn. */
export interface SketchTurnData {
  readonly sketches: readonly SketchEntry[]
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationTurnDataMap {
    /** Successful `sketch_function` plots settled during this Turn, in call order. */
    sketch: SketchTurnData
  }
}

interface SketchTurnState {
  readonly turn: number
  /** Calls whose `tool/call` named the sketch tool, awaiting settlement. */
  readonly calls: ReadonlySet<string>
  readonly sketches: readonly SketchEntry[]
}

/**
 * Select the plots a completed Turn should show as artifacts.
 * @param owner - closing turn and its closing sequence.
 * @returns the plots settled before the closing reply, or null when there are none.
 */
export function selectSketchTurn(owner: TurnTailOwnerProps): readonly SketchEntry[] | null {
  const sketches = owner.turn.data.get('sketch')?.sketches ?? []
  const closing = sketches.filter(entry => entry.seq < owner.seq)
  return closing.length === 0 ? null : closing
}

/** Turn-local plot accumulator; it publishes no view Node. */
export const sketchTurnDefinition: ConversationNodeDefinition<SketchTurnState> = {
  kind: 'sketch',
  match: (event) => {
    if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
    if (event.type === 'tool/call' || event.type === 'tool/result') {
      return { id: String(event.data.turn), role: 'update' }
    }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'turn/start') throw new Error('sketch start requires turn/start')
    return { turn: match.event.data.turn, calls: new Set(), sketches: [] }
  },
  update: (context, match) => {
    if (match.event.type === 'tool/call') {
      if (match.event.data.name !== SKETCH_TOOL_NAME) return context.state
      return { ...context.state, calls: new Set(context.state.calls).add(String(match.event.data.callId)) }
    }
    if (match.event.type !== 'tool/result') return context.state
    const callId = String(match.event.data.message.source.callId)
    if (!context.state.calls.has(callId)) return context.state
    if (match.event.data.message.isError === true) return context.state
    const plot = readSpec(match.event.data.meta)
    if (plot === null) return context.state
    const entry: SketchEntry = { callId, seq: match.event.seq, spec: plot }
    // A settlement redelivered under the same call id replaces its row, so the
    // tail never draws one call twice.
    const others = context.state.sketches.filter(candidate => candidate.callId !== callId)
    return { ...context.state, sketches: [...others, entry] }
  },
  buildLocationData: (context, scope, previous) => {
    if (scope !== 'turn' || context.state === undefined) return null
    const { sketches, turn } = context.state
    if (sketches.length === 0) return null
    if (previous?.kind === 'turn'
      && previous.turn === turn
      && previous.key === 'sketch'
      && previous.value.sketches === sketches) return previous
    return { kind: 'turn', turn, key: 'sketch', value: { sketches } }
  },
}
