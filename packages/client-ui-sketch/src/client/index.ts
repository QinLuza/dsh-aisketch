/**
 * AISketch client plugin, browser half.
 *
 * Draws `sketch_function` in two places that play different roles:
 *
 * - one keyed `tool.call.toolview` entry for the wire name, which *replaces*
 *   the generic tool row rather than sitting beside it;
 * - one `conversation.chat.turnTail` entry, which repeats the same plots over
 *   the completed-Turn action row.
 *
 * The tail is what makes a graph survive the work-details setting: a Tool call
 * belongs to the Turn's process, and a completed Turn folds its process rows
 * away in every mode but `verbose`. Turn tail is the base's artifact channel,
 * exempt from that fold, so the picture the answer was built around stays in
 * the answer. The cards read everything from the settled result's persisted
 * presentation metadata, so a replay draws the same picture with no Host call.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only imports: pull the service merges for ctx.locale and ctx.slots.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the uiConversation service merge and the Turn data map.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import { NS, en, zh, type SketchKey } from './locales.ts'
import { SketchCard } from './SketchCard.tsx'
import { SketchTail } from './SketchTail.tsx'
import { sketchTurnDefinition } from './turn-sketch.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The AISketch tool card's copy. */
    sketch: SketchKey
  }
}

/**
 * Cordis service dependencies of this plugin.
 *
 * This list is **mandatory, not documentation**. Cordis gates every service
 * access on it: reading `ctx.locale` or `ctx.slots` without the matching entry
 * throws `cannot get property "<name>" without inject`, the plugin body never
 * finishes, and the fiber stays in `loading` — which the shell reports as
 * "Failed to load plugins". The names are Cordis *service* names, not package
 * names; `dsh.client.inject` in package.json is a separate, load-order-only
 * list.
 */
export const inject = ['locale', 'slots', 'uiConversation']

/**
 * Client plugin body: register the dictionaries, the Turn plot accumulation,
 * the keyed tool row, and the artifact tail.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'client-ui-sketch: dictionaries')
  ctx.uiConversation.events.register(sketchTurnDefinition)
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register(
    { name: 'tool.call.toolview', key: 'sketch_function', locale: NS },
    SketchCard,
  ))
  ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register(
    { name: 'conversation.chat.turnTail', id: '@aisketch/client-ui-sketch', locale: NS },
    SketchTail,
  ))
}
