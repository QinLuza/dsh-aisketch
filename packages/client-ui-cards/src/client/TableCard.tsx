/**
 * The `table` card: the tabular kind this release renders natively.
 *
 * A table is the honest shape for most numeric answers, so it is the kind the
 * Host validates strictly and the client draws as real DOM -- sticky header,
 * tabular figures, the host's own tokens -- rather than as markup the model
 * composed. A table-shaped payload that fails to parse still renders through
 * the raw fallback, because a refused card the model can see is a card the
 * model can fix.
 */

import { parseTablePayload } from '@aisketch/cards-core'
import type { TableCell } from '@aisketch/cards-core'
import type { CardRendererProps } from './registry.ts'
import { CardFrame } from './CardFrame.tsx'
import { RawCard } from './RawCard.tsx'
import { CLS } from './styles.ts'

/**
 * Render one cell as text.
 * @param cell - the parsed cell.
 * @returns its display text.
 */
function cellText(cell: TableCell): string {
  return cell === null ? '--' : String(cell)
}

/**
 * Draw a table card.
 * @param props - the admitted spec and this plugin's translate.
 * @returns the table card, or the raw fallback when the payload is not a table.
 */
export function TableCard({ card, t }: CardRendererProps) {
  const table = parseTablePayload(card.payload)
  if (table === null) {
    return (
      <RawCard
        title={t('broken.title')}
        hint={t('broken.hint')}
        kind={card.kind}
        data={card.payload}
      />
    )
  }
  return (
    <CardFrame
      kind={card.kind}
      title={card.title ?? t('table.title')}
      summary={t('table.summary', { rows: table.rows.length, columns: table.columns.length })}
      t={t}
    >
      <div className={CLS.scroll}>
        {table.rows.length === 0
          ? <div className={CLS.empty}>{t('table.empty')}</div>
          : (
            <table className={CLS.table}>
              <thead>
                <tr>
                  {table.columns.map((column, index) => (
                    <th key={index} className={CLS.th} scope="col">{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {table.columns.map((_column, columnIndex) => {
                      const cell = row[columnIndex]
                      const numeric = typeof cell === 'number'
                      return (
                        <td key={columnIndex} className={numeric ? `${CLS.td} ${CLS.num}` : CLS.td}>
                          {cell === undefined ? '' : cellText(cell)}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>
    </CardFrame>
  )
}