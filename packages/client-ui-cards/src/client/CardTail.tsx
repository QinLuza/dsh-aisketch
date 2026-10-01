/**
 * The Turn's cards as artifacts of the answer.
 *
 * The `card` node lives inside the Turn's process, and a completed Turn folds
 * its process rows away in every work-details mode but `verbose` -- so a table
 * the answer was built around would vanish with the calls that produced it.
 * This tail contributes the same cards over the completed-Turn action row,
 * where the fold does not reach.
 */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { CardView } from './CardView.tsx'
import { NS } from './locales.ts'
import { selectCardsTurn } from './turn-cards.ts'

/**
 * Draw every card this Turn called before its closing reply.
 * @param props - closing Turn, its closing sequence, and the cards dictionary.
 * @returns the cards, or null when the Turn showed none.
 */
export function CardTail(props: PropsRuntime<'conversation.chat.turnTail'> & PropsLocale<typeof NS>) {
  const cards = selectCardsTurn(props)
  if (cards === null) return null
  return (
    <>
      {cards.map(entry => (
        <CardView key={entry.callId} card={entry.card} raw={entry.raw} t={props.t} />
      ))}
    </>
  )
}
