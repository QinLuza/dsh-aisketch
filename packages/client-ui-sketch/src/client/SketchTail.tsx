/**
 * The turn's function graphs as artifacts of the answer.
 *
 * The toolview row lives inside the Turn's process, and a completed Turn folds
 * its process rows away in every work-details mode but `verbose`. This tail
 * contributes the same plots over the completed-Turn action row, where the
 * fold does not reach: a graph the answer was built around stays in the answer.
 */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { SketchFigure } from './SketchFigure.tsx'
import { NS } from './locales.ts'
import { selectSketchTurn } from './turn-sketch.ts'

/**
 * Draw every plot this Turn settled before its closing reply.
 * @param props - closing Turn, its closing sequence, and the sketch dictionary.
 * @returns the plots, or null when the Turn drew none.
 */
export function SketchTail(props: PropsRuntime<'conversation.chat.turnTail'> & PropsLocale<typeof NS>) {
  const plots = selectSketchTurn(props)
  if (plots === null) return null
  return (
    <>
      {plots.map(plot => (
        <SketchFigure key={plot.callId} spec={plot.spec} t={props.t} />
      ))}
    </>
  )
}
