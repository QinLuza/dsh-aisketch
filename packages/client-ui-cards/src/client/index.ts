/**
 * Cards client plugin, browser half.
 *
 * One chat node kind (`card`) carries every card there will ever be, and the
 * node dispatches on the spec's own `kind` through the renderer registry. This
 * plugin contributes four things: the `table` and `flowchart` renderers this
 * release ships, the projection that turns a `show_card` call into a `card`
 * node, that node's view, and the completed-Turn tail that repeats the same
 * cards as artifacts of the answer.
 *
 * The tail is what makes a card survive the work-details setting: a Tool call
 * belongs to the Turn's process, and a completed Turn folds its process rows
 * away in every mode but `verbose`. Turn tail is the base's artifact channel,
 * exempt from that fold, so a table the answer was built around stays in the
 * answer. A later card type -- in this plugin or in someone else's -- registers
 * a renderer and inherits all four.
 *
 * Both halves of the wire share `@gk/cards-core`: the Host admits the spec, the
 * client parses the identical shape back out of the persisted arguments.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only imports: pull the service merges for ctx.locale and ctx.slots.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the Conversation service, the Chat node slot, and the Turn
// tail slot, plus the `ChatNodeDataMap` / `ConversationTurnDataMap` keys this
// package contributes.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import { FLOWCHART_KIND, TABLE_KIND } from '@gk/cards-core'
import { CARD_NODE_KIND, cardDefinition } from './card-definition.ts'
import { CardNode } from './CardNode.tsx'
import { CardTail } from './CardTail.tsx'
import { FlowchartCard } from './FlowchartCard.tsx'
import { TableCard } from './TableCard.tsx'
import { registerCardRenderer } from './registry.ts'
import { cardTurnDefinition } from './turn-cards.ts'
import { en, NS, zh } from './locales.ts'

/** This implementation's identity in the renderer registry. */
export const CARD_RENDERER_ID = '@gk/client-ui-cards'

/**
 * Cordis service dependencies of this plugin.
 *
 * This list is **mandatory, not documentation**: Cordis gates every service
 * access on it, so reading `ctx.locale`, `ctx.slots` or `ctx.uiConversation`
 * without the matching entry throws `cannot get property "<name>" without
 * inject`, the plugin body never finishes, and the fiber stays in `loading` --
 * which the shell reports as "Failed to load plugins". The names are Cordis
 * *service* names; `dsh.client.inject` in package.json is a separate,
 * load-order-only list.
 */
export const inject = ['locale', 'slots', 'uiConversation']

/**
 * Client plugin body: the dictionaries, the shipped renderer, the projection,
 * the Turn accumulation, the node view, and the artifact tail.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'client-ui-cards: dictionaries')
  // Registered before the node view can render any node, and idempotent so a
  // re-applied plugin re-claims `table` without a conflict.
  ctx.effect(
    () => registerCardRenderer(TABLE_KIND, { id: CARD_RENDERER_ID, trust: 'native', component: TableCard }),
    'client-ui-cards: table renderer',
  )
  // The second shipped kind: structure in, deterministic layout out. A plugin
  // adding a third kind claims it the same way, from anywhere.
  ctx.effect(
    () => registerCardRenderer(FLOWCHART_KIND, { id: CARD_RENDERER_ID, trust: 'native', component: FlowchartCard }),
    'client-ui-cards: flowchart renderer',
  )
  ctx.uiConversation.events.register(cardDefinition)
  ctx.uiConversation.events.register(cardTurnDefinition)
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: CARD_NODE_KIND,
    locale: NS,
  }, CardNode))
  ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register(
    { name: 'conversation.chat.turnTail', id: CARD_RENDERER_ID, locale: NS },
    CardTail,
  ))
}
