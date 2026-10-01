/**
 * Picking the curve point under a cursor.
 *
 * Pure: the caller supplies already-compiled evaluators, so this module carries
 * no parser import and the whole pick is a function of cursor, viewport, and
 * curves. Distance is measured vertically on purpose -- a hover readout answers
 * "what is y here", and a Euclidean distance would prefer a steep segment over
 * the point the cursor actually sits on.
 */
import type { CompiledFn } from '@gk/sketch-core'
import type { Viewport } from './render.ts'

/** One candidate curve: its evaluator and the colour it was drawn in. */
export interface ReadoutCurve {
  readonly fn: CompiledFn
  readonly color: string
}

/** The picked point, in both math and canvas coordinates. */
export interface ReadoutPoint {
  readonly x: number
  readonly y: number
  readonly color: string
  readonly px: number
  readonly py: number
}

/** Cursor, view, candidates, and the live parameter values. */
export interface ReadoutRequest {
  readonly px: number
  readonly py: number
  /** The same fitted viewport the frame was drawn with. */
  readonly vp: Viewport
  readonly curves: readonly ReadoutCurve[]
  readonly values: Readonly<Record<string, number>>
}

/**
 * Trace the curve at the cursor's column.
 *
 * Any position inside the plot yields a point, so sweeping the cursor reads the
 * curve continuously instead of making the user aim.
 * @param request - the pick inputs.
 * @returns the nearest curve's point, or null outside the plot or where nothing is defined.
 */
export function pickReadout(request: ReadoutRequest): ReadoutPoint | null {
  const { px, py, vp, curves, values } = request
  if (px < 0 || py < 0 || px > vp.width || py > vp.height) return null
  const x = vp.xAt(px)
  let best: ReadoutPoint | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const { fn, color } of curves) {
    let y: number
    try {
      y = fn({ ...values, x })
    } catch {
      // A closed interpreter can reject a domain (log of a negative); that curve
      // simply has no point to offer at this column.
      continue
    }
    if (!Number.isFinite(y)) continue
    const cursorY = vp.py(y)
    const distance = Math.abs(cursorY - py)
    if (distance < bestDistance) {
      bestDistance = distance
      best = { x, y, color, px, py: cursorY }
    }
  }
  return best
}

/**
 * Format a readout number.
 * @param value - the sampled coordinate.
 * @returns three decimals for ordinary magnitudes, significant form at the
 * extremes, and the non-finite cases named rather than invented.
 */
export function formatReadout(value: number): string {
  if (Number.isNaN(value)) return 'NaN'
  if (!Number.isFinite(value)) return value > 0 ? '∞' : '-∞'
  const magnitude = Math.abs(value)
  if (magnitude !== 0 && (magnitude >= 1000 || magnitude < 0.001)) return value.toExponential(2)
  return String(Number(value.toFixed(3)))
}
