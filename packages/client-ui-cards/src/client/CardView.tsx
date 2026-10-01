/**
 * One card's body, shared by both faces of the channel.
 *
 * The `card` chat node draws a card where its call happened; the completed-Turn
 * tail draws the same card where the fold cannot reach (see `turn-cards.ts`).
 * Both dispatch through the renderer registry here, so a kind looks identical in
 * either place and a plugin that activates later claims both.
 */

import { useSyncExternalStore } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type { CardSpec } from '@gk/cards-core'
import { cardRenderer, cardRendererVersion, subscribeCardRenderers } from './registry.ts'
import { RawCard } from './RawCard.tsx'
import type { NS } from './locales.ts'
import { ensureStyles } from './styles.ts'

// The browser half is served as one prebuilt bundle with no CSS-modules
// pipeline, so the sheet is injected once instead of imported.
ensureStyles()

/** What either face knows about one card: the admitted spec and the raw call. */
export interface CardViewProps {
  /** The admitted spec, or null when the call's arguments never formed one. */
  readonly card: CardSpec | null
  /** The call's arguments verbatim, for either fallback. */
  readonly raw: unknown
  /** This plugin's translate, bound to the `cards` dictionary. */
  readonly t: TranslateNS<typeof NS>
}

/**
 * Draw one card: the registered renderer for its kind, or a named fallback.
 * @param props - the admitted spec, the raw arguments, and this plugin's copy.
 * @returns the renderer's output, the raw fallback, or the broken-card fallback.
 */
export function CardView({ card, raw, t }: CardViewProps) {
  // Subscribe to the registry so a plugin activating after this row was already
  // on screen still claims its cards, instead of leaving them raw forever.
  useSyncExternalStore(subscribeCardRenderers, cardRendererVersion, cardRendererVersion)
  if (card === null) {
    return <RawCard title={t('broken.title')} hint={t('broken.hint')} data={raw} />
  }
  const entry = cardRenderer(card.kind)
  if (entry === undefined) {
    return <RawCard title={t('unknown.title')} hint={t('unknown.hint')} kind={card.kind} data={card.payload} />
  }
  const Renderer = entry.component
  return <Renderer card={card} t={t} />
}
