/**
 * The `card` chat node: the generic channel's projection.
 *
 * It matches the `show_card` tool's *call* -- not its result -- so a card
 * appears while the tool is still running, and it reads the card straight out
 * of the call arguments. A call marked draft:true is a private preview for the
 * model and publishes no card; only the finished call produces a node. Those arguments already live in the transcript, so a
 * replayed session rebuilds the identical card with no Host round trip and no
 * second source of truth to drift.
 *
 * An unusable envelope is not a reason to disappear: the projection still
 * publishes a node whose `card` is null, and the view draws the raw arguments.
 * A bad card the model can see is a card the model can fix.
 */

import { CARD_TOOL_NAME, parseCardSpec } from '@aisketch/cards-core'
import type { CardSpec } from '@aisketch/cards-core'
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'

/** The chat node kind this plugin owns; also the `conversation.chat.node` slot key. */
export const CARD_NODE_KIND = 'card'

/** Payload of one `card` chat node. */
export interface CardNodeData {
  /** The admitted spec, or null when the call's arguments are not a usable card. */
  readonly card: CardSpec | null
  /** The call's arguments verbatim, so the raw fallback shows what actually arrived. */
  readonly raw: unknown
}

interface CardNodeState extends CardNodeData {
  readonly seq: number
  readonly callId: string
  /** A private draft submits no visible card; only the finished drawing does. */
  readonly draft: boolean
}

/**
 * Read one call's arguments out of its event.
 *
 * The event carries the model-produced JSON *text*, not a parsed object -- the
 * exact bytes the Host logged, which is what makes this projection replayable.
 * Parsing is therefore part of the channel rather than a convenience: handing
 * the text straight to `parseCardSpec` refuses every card, which is the failure
 * the first live run produced.
 *
 * Exported because the completed-Turn tail (`turn-cards.ts`) reads the identical
 * bytes: one reader means the node and the tail cannot disagree about what a
 * call said.
 * @param value - the event's `arguments`, normally JSON text.
 * @returns the parsed value when it is parseable, plus the original text.
 */
export function readCallArguments(value: unknown): { readonly parsed: unknown; readonly text: string | undefined } {
  if (typeof value !== 'string') return { parsed: value, text: undefined }
  try {
    return { parsed: JSON.parse(value) as unknown, text: value }
  } catch {
    return { parsed: undefined, text: value }
  }
}

/**
 * Whether one call is a private draft.
 *
 * The flag lives on the tool call, not in the CardSpec: it controls delivery,
 * not the picture. A draft still returns its preview and self-check to the
 * model, but the conversation must not show its card. Replay reads the same
 * persisted argument text, so the draft stays invisible after a reload.
 * @param parsed - the call arguments after JSON parsing, or the object itself.
 * @returns true only for an explicit boolean true.
 */
export function isPrivateDraft(parsed: unknown): boolean {
  return typeof parsed === 'object'
    && parsed !== null
    && (parsed as { readonly draft?: unknown }).draft === true
}

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap {
    /** One generic card, emitted by the `show_card` Tool. */
    'card': CardNodeData
  }
}

/** Project one card per public `show_card` call; private drafts publish no node. */
export const cardDefinition: ConversationNodeDefinition<CardNodeState> = {
  kind: 'cards',
  target: 'chat',
  match: (event) => {
    if (event.type !== 'tool/call') return null
    const data = event.data as { readonly name?: unknown; readonly callId?: unknown }
    if (data.name !== CARD_TOOL_NAME) return null
    return { id: String(data.callId), role: 'start' }
  },
  start: (_context, match) => {
    if (match.event.type !== 'tool/call') throw new Error('card start requires tool/call')
    const data = match.event.data as { readonly callId?: unknown; readonly arguments?: unknown }
    const call = readCallArguments(data.arguments)
    return {
      seq: match.event.seq,
      callId: String(data.callId),
      card: parseCardSpec(call.parsed),
      // Unparseable text stays visible verbatim; a parsed-but-invalid envelope
      // shows as data instead of an escaped string.
      raw: call.parsed === undefined ? call.text : call.parsed,
      draft: isPrivateDraft(call.parsed),
    }
  },
  update: context => context.state,
  buildViewNode: (context) => {
    if (context.state === undefined) return null
    // A private draft is a picture for the model to inspect, not an artifact of
    // the answer. The completed-Turn tail applies the same rule and falls back
    // to the last draft only when no final card was ever published.
    if (context.state.draft) return null
    return {
      key: context.key,
      kind: CARD_NODE_KIND,
      id: context.id,
      target: 'chat',
      // Just above the Tool's own row, matching how a human command line sits
      // before the result it produced.
      anchorSeq: context.state.seq - 0.1,
      location: context.start?.location ?? { kind: 'unresolved' },
      visibility: 'visible',
      data: { card: context.state.card, raw: context.state.raw },
    }
  },
}