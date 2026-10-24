/**
 * The `card` chat node view: the card where its call happened.
 *
 * The node owns no card knowledge of its own -- `CardView` resolves `spec.kind`
 * through the renderer registry and hands the spec over. That indirection is the
 * whole design: the conversation has one node kind for every card there will
 * ever be, and a new card type is a registration rather than a contract change.
 *
 * This face sits inside the Turn's process and is therefore folded away when the
 * Turn completes; `CardTail` repeats the same cards where the fold cannot reach.
 * Private draft calls never reach this node: they are a preview for the model,
 * not an artifact of the answer.
 */

import { memo } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the keyed Chat node slot and its data map merge.
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import { CardView } from './CardView.tsx'
import type { NS } from './locales.ts'

type CardNodeViewProps = PropsRuntime<'conversation.chat.node', 'card'> & PropsLocale<typeof NS>

/**
 * Draw one card where its call was made.
 * @param props - the projected node and this plugin's translate.
 * @returns the registered renderer's output, or the raw fallback.
 */
export const CardNode = memo(function CardNode({ node, t }: CardNodeViewProps) {
  const { card, raw } = node.data
  return <CardView card={card} raw={raw} t={t} />
})
