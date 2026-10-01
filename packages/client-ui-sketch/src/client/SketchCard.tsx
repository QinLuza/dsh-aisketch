/**
 * The `sketch_function` toolview row.
 *
 * Registered against the keyed `tool.call.toolview` slot for the wire tool
 * name, so it replaces the generic tool row. Everything it draws comes from
 * the persisted spec in the result's presentation metadata — no live Host call
 * — which is what makes a replayed session render the identical picture.
 *
 * This row sits in the Turn's process, which a completed Turn folds away; the
 * same plot reaches the answer as an artifact through `conversation.chat.turnTail`
 * (see `SketchTail.tsx`). Both render one `SketchFigure`.
 */

import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { SketchFigure } from './SketchFigure.tsx'
import { NS } from './locales.ts'
import { readSpec } from './spec.ts'
import { CLS } from './styles.ts'

/**
 * Render one `sketch_function` call's stage.
 * @param props - keyed toolview payload plus the sketch locale seat.
 * @returns the card for the current stage.
 */
export function SketchCard(props: ToolCallViewProps & PropsLocale<typeof NS>) {
  if (props.phase === 'preparing') {
    return (
      <div className={CLS.card} data-tool="sketch_function" data-state="preparing">
        <div className={CLS.head}>
          <span className={CLS.title}>{props.t('card.preparing')}</span>
        </div>
      </div>
    )
  }

  if (props.phase !== 'result') return null

  const { block, t } = props

  if (block.isError) {
    return (
      <div className={CLS.card} data-tool="sketch_function" data-state="error">
        <div className={CLS.head}>
          <span className={CLS.title}>{t('card.failed')}</span>
        </div>
      </div>
    )
  }

  const spec = readSpec(block.meta)
  if (spec === null) {
    return (
      <div className={CLS.card} data-tool="sketch_function" data-state="ok">
        <div className={CLS.head}>
          <span className={CLS.title}>{t('card.title')}</span>
        </div>
        <div className={CLS.empty}>{t('card.empty')}</div>
      </div>
    )
  }

  return <SketchFigure spec={spec} t={t} />
}
