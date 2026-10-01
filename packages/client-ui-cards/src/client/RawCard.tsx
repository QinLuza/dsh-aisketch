/**
 * The raw fallback: what a card shows when nothing claims its `kind`, or when
 * the call's arguments never formed a card at all.
 *
 * The channel's rule is that a card never silently disappears. A kind from a
 * newer producer, a payload the Host refused, a hand-written call: all of them
 * land here, named and legible, so the model can read what actually arrived and
 * correct it instead of wondering why its card went missing.
 */

import { CLS } from './styles.ts'

/** Raw fallback props; `kind` is absent for a call that never named one. */
export interface RawCardProps {
  readonly title: string
  readonly hint: string
  readonly kind?: string
  readonly data: unknown
}

/**
 * Serialize a payload for display without ever throwing.
 * @param data - the value to show.
 * @returns pretty JSON, or the value's own string form when it is not JSON.
 */
function format(data: unknown): string {
  if (data === undefined) return '(no arguments)'
  try {
    const text = JSON.stringify(data, null, 2)
    return text === undefined ? String(data) : text
  } catch {
    return String(data)
  }
}

/**
 * Draw the fallback card.
 * @param props - heading, explanation, optional kind chip, and the value to show.
 * @returns the raw card.
 */
export function RawCard({ title, hint, kind, data }: RawCardProps) {
  return (
    <div className={CLS.card} data-card-raw="">
      <div className={CLS.head}>
        <span className={CLS.title}>{title}</span>
        {kind === undefined ? null : <span className={CLS.kind}>{kind}</span>}
      </div>
      <div className={CLS.hint}>{hint}</div>
      <pre className={CLS.raw}>{format(data)}</pre>
    </div>
  )
}