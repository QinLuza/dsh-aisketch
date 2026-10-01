/**
 * Turn-scoped cards, published as Turn Location data.
 *
 * A Tool call belongs to a Turn's process, and a normally completed Turn folds
 * its process rows behind the whole-Turn control (`foldCompletedTurns` is true
 * in every work-details mode but `verbose`; the exemption list in the base's
 * `contract/turn-process.ts` names eight Turn skeleton kinds and no card node).
 * A table the answer is built around is an artifact of that answer, not process
 * noise, so it also rides the channel the base reserves for artifacts: this
 * Definition accumulates the Turn's cards and the completed-Turn tail renders
 * them where nothing folds.
 *
 * The source is the persisted `tool/call` arguments -- the same bytes the `card`
 * node projects from -- so the two faces never disagree and a replayed session
 * redraws the identical cards with no Host call.
 */
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { CardSpec } from '@gk/cards-core'
import { CARD_TOOL_NAME, parseCardSpec } from '@gk/cards-core'
import { readCallArguments } from './card-definition.ts'

/** One card carried by a Turn. */
export interface CardEntry {
  readonly callId: string
  /** Sequence of the `tool/call` that carries it, so the tail can order it. */
  readonly seq: number
  readonly card: CardSpec | null
  readonly raw: unknown
}

/** Immutable card facts published against one Turn. */
export interface CardsTurnData {
  readonly cards: readonly CardEntry[]
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationTurnDataMap {
    /** `show_card` calls of this Turn, in call order. The key must be the
     *  Definition's own kind: the assembler rejects a Turn-data publication
     *  whose key differs from it, and the rejection takes the entry down. */
    'card-tail': CardsTurnData
  }
}

interface CardsTurnState {
  readonly turn: number
  readonly cards: readonly CardEntry[]
}

/**
 * Select the cards a completed Turn should show as artifacts.
 * @param owner - closing turn and its closing sequence.
 * @returns the cards called before the closing reply, or null when there are none.
 */
export function selectCardsTurn(owner: TurnTailOwnerProps): readonly CardEntry[] | null {
  const cards = owner.turn.data.get('card-tail')?.cards ?? []
  const closing = cards.filter(entry => entry.seq < owner.seq)
  return closing.length === 0 ? null : closing
}

/** Turn-local card accumulator; it publishes no view Node. */
export const cardTurnDefinition: ConversationNodeDefinition<CardsTurnState> = {
  kind: 'card-tail',
  match: (event) => {
    if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
    if (event.type === 'tool/call') return { id: String(event.data.turn), role: 'update' }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'turn/start') throw new Error('card tail start requires turn/start')
    return { turn: match.event.data.turn, cards: [] }
  },
  update: (context, match) => {
    if (match.event.type !== 'tool/call') return context.state
    const data = match.event.data as {
      readonly name?: unknown
      readonly callId?: unknown
      readonly arguments?: unknown
    }
    if (data.name !== CARD_TOOL_NAME) return context.state
    const call = readCallArguments(data.arguments)
    const callId = String(data.callId)
    const entry: CardEntry = {
      callId,
      seq: match.event.seq,
      card: parseCardSpec(call.parsed),
      // Unparseable text stays visible verbatim; a parsed-but-invalid envelope
      // shows as data instead of an escaped string -- identical to the node.
      raw: call.parsed === undefined ? call.text : call.parsed,
    }
    // A redelivered call replaces its row, so the tail never draws one twice.
    const others = context.state.cards.filter(candidate => candidate.callId !== callId)
    return { ...context.state, cards: [...others, entry] }
  },
  buildLocationData: (context, scope, previous) => {
    if (scope !== 'turn' || context.state === undefined) return null
    const { cards, turn } = context.state
    if (cards.length === 0) return null
    if (previous?.kind === 'turn'
      && previous.turn === turn
      && previous.key === 'card-tail'
      && previous.value.cards === cards) return previous
    return { kind: 'turn', turn, key: 'card-tail', value: { cards } }
  },
}
