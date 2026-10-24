/**
 * The live plot: one card, one Canvas, drawn from a persisted spec.
 *
 * Both surfaces that show a graph render this component -- the `sketch_function`
 * toolview row inside the Turn's process, and the completed-Turn tail that
 * carries the same plot as an artifact of the answer. Keeping one implementation
 * is what stops the two from disagreeing about what a spec draws.
 *
 * Geometry comes from `@aisketch/sketch-core`, the module the Host tool used, so the
 * picture is derived rather than transported: no live Host call, and a replayed
 * session renders the identical plot.
 *
 * Interaction -- the sliders and the readout tracer -- is local to this
 * component. The persisted spec keeps the values the call declared, so a reload
 * or a replay rests every slider back where the AI put it and no session event
 * is written.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { normalizeMode, resolveGeometry } from '@aisketch/sketch-core'
import type { Mode, SketchSpec } from '@aisketch/sketch-core'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import {
  COLORS,
  Viewport,
  categoryCenterX,
  drawAxes,
  drawCartesianChart,
  drawCurve,
  drawPieChart,
  drawPoint,
  drawRiemann,
} from './render.ts'
import type { ChartType, Sample, Series } from './render.ts'
import { NS } from './locales.ts'
import type { SketchKey } from './locales.ts'
import { CLS, ensureStyles } from './styles.ts'
import { compileCurves, freezeWindow, initialValues, stepOf, withValues } from './params.ts'
import type { ParamValues } from './params.ts'
import { formatReadout, pickReadout } from './readout.ts'
import type { ReadoutCurve } from './readout.ts'

// The browser half is served as one prebuilt bundle with no CSS-modules
// pipeline, so the sheet is injected once instead of imported.
ensureStyles()

/** Card geometry in CSS pixels; the canvas backs itself at device resolution. */
const WIDTH = 620
const HEIGHT = 380

/** The expanded overlay draws at this size, so a dense curve stays readable. */
const EXPANDED_WIDTH = 1000
const EXPANDED_HEIGHT = 600

/** Parameter sweep: how long one animation frame advances the value. */
const SWEEP_STEP = 0.06

/** One arrow-key step of the tracer, as a fraction of the plot width. */
const TRACE_KEYS = 200

/** The modes the tracer serves; the annotated modes already mark their own points. */
const TRACED_MODES: readonly Mode[] = ['plain', 'compare']

/** Sample data for the chart modes, keyed by the spec's `dataset` name. */
const DATASETS: Record<ChartType, readonly Series[]> = {
  line: [{ label: 'A', data: [12, 19, 14, 22, 18, 25, 21] }],
  bar: [
    { label: '上学期', data: [72, 85, 63, 90, 78] },
    { label: '下学期', data: [80, 88, 70, 94, 83] },
  ],
  scatter: [{ label: '样本', data: [8, 14, 11, 19, 16, 23, 20] }],
  pie: [{ label: '分布', data: [35, 25, 20, 12, 8] }],
}

/** Read the chart kind a data-mode spec asked for. */
function readChartType(spec: SketchSpec): ChartType {
  const name = spec.data ?? spec.series ?? 'line'
  return name === 'bar' || name === 'scatter' || name === 'pie' ? name : 'line'
}

/** Convert core points into the renderer's tuple form. */
function toSamples(points: readonly { readonly x: number; readonly y: number | null }[]): Sample[] {
  return points.map((p) => [p.x, p.y] as const)
}

/** The parameter swept by the animation: the first one declared. */
function leadName(spec: SketchSpec): string | undefined {
  return Object.keys(spec.params ?? {})[0]
}

/** Draw one frame of geometry into a 2D context. */
function paint(ctx: CanvasRenderingContext2D, spec: SketchSpec, geometry: ReturnType<typeof resolveGeometry>, vp: Viewport): void {
  if (geometry.mode === 'data') {
    const chart = readChartType(spec)
    const series = DATASETS[chart]
    if (chart === 'pie') {
      drawPieChart(ctx, vp, series)
    } else {
      drawCartesianChart(ctx, vp, series, chart)
      // Category captions, which the chart renderer deliberately leaves to the caller.
      ctx.fillStyle = COLORS.text
      ctx.font = '11px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      const labels = series[0]?.data.map((_, i) => `类别 ${i + 1}`) ?? []
      labels.forEach((label, i) => {
        ctx.fillText(label, categoryCenterX(vp, i, labels.length), HEIGHT - 22)
      })
    }
    return
  }

  drawAxes(ctx, vp)

  geometry.curves.forEach((curve, i) => {
    drawCurve(ctx, vp, toSamples(curve.points), COLORS.curve[i % COLORS.curve.length] ?? COLORS.curve[0])
  })

  const tangent = geometry.tangent
  if (tangent !== undefined) {
    const span = geometry.xRange[1] - geometry.xRange[0]
    const left = tangent.x - span
    const right = tangent.x + span
    drawCurve(
      ctx,
      vp,
      [
        [left, tangent.y + tangent.slope * (left - tangent.x)],
        [right, tangent.y + tangent.slope * (right - tangent.x)],
      ],
      COLORS.tangent,
      1.5,
      [6, 4],
    )
    drawPoint(ctx, vp, tangent.x, tangent.y, `f'(x)=${tangent.slope.toFixed(3)}`)
  }

  const riemann = geometry.riemann
  if (riemann !== undefined) {
    const curve = geometry.curves[0]
    if (curve !== undefined) {
      const lookup = new Map<number, number>()
      for (const p of curve.points) if (p.y !== null) lookup.set(p.x, p.y)
      const width = geometry.xRange[1] - geometry.xRange[0]
      const sampleAt = (x: number): number => {
        // Nearest-sample lookup: the bars only need midpoints, which are
        // already dense at this sampling rate.
        let best = Number.NaN
        let bestDistance = Number.POSITIVE_INFINITY
        for (const [sx, sy] of lookup) {
          const d = Math.abs(sx - x)
          if (d < bestDistance) {
            bestDistance = d
            best = sy
          }
        }
        return bestDistance <= width / 200 ? best : Number.NaN
      }
      drawRiemann(ctx, vp, sampleAt, riemann.a, riemann.b, riemann.n)
    }
  }

  const taylor = geometry.taylor
  if (taylor !== undefined) {
    drawCurve(ctx, vp, toSamples(taylor.points), COLORS.curve[2] ?? COLORS.curve[0], 2, [5, 4])
    drawPoint(ctx, vp, taylor.center, taylor.coefficients[0] ?? 0, undefined, COLORS.point)
  }
}

/** Label for the mode chip. */
function modeLabel(mode: Mode, t: (key: SketchKey) => string): string {
  return t(`mode.${mode}` as SketchKey)
}

/** Cursor position in canvas pixels, corrected for a card scaled below its design width. */
function canvasOffset(element: HTMLCanvasElement, clientX: number, clientY: number, width: number, height: number): { px: number; py: number } {
  const rect = element.getBoundingClientRect()
  return {
    px: ((clientX - rect.left) * width) / rect.width,
    py: ((clientY - rect.top) * height) / rect.height,
  }
}

/** A spec plus the localized copy seat. */
export type SketchFigureProps = { readonly spec: SketchSpec } & PropsLocale<typeof NS>

/** One plot surface: the head row, the Canvas with its readout tracer, and the sliders. */
interface SketchPlotProps extends SketchFigureProps {
  /** Canvas width in CSS pixels. */
  readonly width: number
  /** Canvas height in CSS pixels. */
  readonly height: number
  /** Show the expand control; absent on the overlay's own plot. */
  readonly onExpand?: (() => void) | undefined
  /** Show the close control; only the overlay's plot has one. */
  readonly onClose?: (() => void) | undefined
}

/**
 * Render one spec as a live plot: the head row, the Canvas with its readout
 * tracer, and one slider per declared parameter.
 * @param props - the persisted spec, the `sketch` dictionary, and the surface size.
 * @returns the card.
 */
function SketchPlot({ spec, t, width, height, onExpand, onClose }: SketchPlotProps) {
  const canvas = useRef<HTMLCanvasElement | null>(null)

  // Interaction state is local by decision: the spec keeps the declared values,
  // so nothing here survives a reload or reaches the session log.
  const [values, setValues] = useState<ParamValues>(() => initialValues(spec))
  const [playing, setPlaying] = useState(false)
  const [cursor, setCursor] = useState<{ px: number; py: number } | null>(null)
  const [pinned, setPinned] = useState(false)

  const mode = useMemo(() => normalizeMode(spec.mode), [spec.mode])
  const params = Object.entries(spec.params ?? {})
  const lead = leadName(spec)

  // A new call, expression, or parameter set restarts from the declared values.
  useEffect(() => {
    setPlaying(false)
    setPinned(false)
    setCursor(null)
    setValues(initialValues(spec))
  }, [spec])

  // The held y-window covers every corner of the parameter box, so dragging any
  // slider changes the curve and never the axes.
  const frozenY = useMemo(() => freezeWindow(spec), [spec])

  const geometry = useMemo(
    () => resolveGeometry(withValues(spec, values), { frozenYRange: frozenY }),
    [spec, values, frozenY],
  )

  // One compile per expression, reused by every tracer move. Comparison lines
  // carry a "label, expr" prefix, so `compileCurves` splits before compiling --
  // compiling the raw line took the whole card down once.
  const evaluators = useMemo(() => compileCurves(spec), [spec])

  const viewport = useMemo(
    () => new Viewport(geometry.xRange[0], geometry.xRange[1], frozenY.yMin, frozenY.yMax).fit(width, height),
    [geometry.xRange, frozenY, width, height],
  )

  // Draw whenever the geometry or the tracer moves.
  useEffect(() => {
    const element = canvas.current
    if (element === null) return
    const ratio = Math.max(1, globalThis.devicePixelRatio ?? 1)
    element.width = width * ratio
    element.height = height * ratio
    const ctx = element.getContext('2d')
    if (ctx === null) return
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    paint(ctx, spec, geometry, viewport)
    if (cursor === null || !TRACED_MODES.includes(mode)) return
    const curves: ReadoutCurve[] = geometry.curves.flatMap((curve) => {
      const fn = evaluators.get(curve.expr)
      const index = geometry.curves.indexOf(curve)
      return fn === undefined ? [] : [{ fn, color: COLORS.curve[index % COLORS.curve.length] ?? COLORS.curve[0] }]
    })
    const point = pickReadout({ px: cursor.px, py: cursor.py, vp: viewport, curves, values })
    if (point !== null) {
      drawPoint(ctx, viewport, point.x, point.y, `(${formatReadout(point.x)}, ${formatReadout(point.y)})`, point.color)
    }
  }, [spec, geometry, viewport, cursor, mode, evaluators, values, width, height])
  // The sweep timer advances the lead parameter and writes through the same
  // state the slider reads, so the handle follows the animation.
  useEffect(() => {
    if (!playing || lead === undefined) return
    const tuple = spec.params?.[lead]
    if (tuple === undefined) return
    const id = setInterval(() => {
      setValues((current) => {
        const [lo, hi] = tuple
        const span = hi - lo
        const next = (current[lead] ?? tuple[2]) + span * SWEEP_STEP
        return { ...current, [lead]: next > hi ? lo : next }
      })
    }, 50)
    return () => clearInterval(id)
  }, [playing, lead, spec.params])

  const setValue = useCallback((name: string, value: number) => {
    setValues((current) => ({ ...current, [name]: value }))
  }, [])

  const reset = useCallback(() => {
    setPlaying(false)
    setValues(initialValues(spec))
  }, [spec])

  const traceTo = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    const element = canvas.current
    if (element === null) return
    setCursor(canvasOffset(element, event.clientX, event.clientY, width, height))
  }, [width, height])

  const onKeyDown = (event: ReactKeyboardEvent<HTMLCanvasElement>): void => {
    const step = width / TRACE_KEYS
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      const at = cursor ?? { px: width / 2, py: height / 2 }
      setCursor({ ...at, px: Math.min(width, Math.max(0, at.px + (event.key === 'ArrowRight' ? step : -step))) })
      return
    }
    if (event.key === 'Escape') {
      setPinned(false)
      setCursor(null)
    }
  }

  return (
    <div className={CLS.card} data-tool="sketch_function" data-state="ok">
      <div className={CLS.head}>
        <span className={CLS.title}>{spec.expr}</span>
        <span className={CLS.chip}>{modeLabel(mode, t)}</span>
        <span className={CLS.actions}>
          {lead !== undefined && (
            <button
              type="button"
              className={CLS.action}
              onClick={() => setPlaying((value) => !value)}
            >
              {playing ? t('card.pause') : t('card.animate')}
            </button>
          )}
          {onExpand === undefined ? null : (
            <button
              type="button"
              className={CLS.action}
              onClick={onExpand}
              aria-label={t('card.expand')}
              title={t('card.expand')}
            >
              ⤢
            </button>
          )}
          {onClose === undefined ? null : (
            <button
              type="button"
              className={CLS.action}
              onClick={onClose}
              aria-label={t('card.close')}
              title={t('card.close')}
            >
              ✕
            </button>
          )}
        </span>
      </div>
      <canvas
        ref={canvas}
        className={CLS.canvas}
        style={{ width: `${width}px`, height: `${height}px` }}
        role="img"
        tabIndex={0}
        aria-label={spec.expr}
        title={t('card.readoutHint')}
        onPointerMove={traceTo}
        onPointerDown={(event) => {
          setPinned((value) => !value)
          traceTo(event)
        }}
        onPointerLeave={() => {
          if (!pinned) setCursor(null)
        }}
        onKeyDown={onKeyDown}
      />
      {params.length > 0 && (
        <div className={CLS.params}>
          <div>
            <span className={CLS.paramsLabel}>{t('card.param')}</span>
            <button type="button" className={CLS.action} onClick={reset}>
              {t('card.reset')}
            </button>
          </div>
          {params.map(([name, tuple]) => {
            const declared = values[name] ?? tuple[2]
            const clamped = Math.min(tuple[1], Math.max(tuple[0], declared))
            return (
              <label key={name} className={CLS.paramRow}>
                <span className={CLS.paramName}>{name}</span>
                <input
                  className={CLS.paramRange}
                  type="range"
                  min={tuple[0]}
                  max={tuple[1]}
                  step={stepOf(tuple)}
                  value={clamped}
                  onChange={(event) => setValue(name, Number(event.currentTarget.value))}
                />
                <span className={CLS.paramValue}>{formatReadout(clamped)}</span>
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * The plot card and its expand overlay.
 *
 * Expanding draws the plot again at a larger canvas instead of moving the
 * mounted card: a portal keeps the overlay above the chat's scroll containers,
 * and the copy starts from the declared parameter values, which is the only
 * state the spec owns.
 * @param props - the persisted spec and the `sketch` dictionary.
 * @returns the card plus, once expanded, its larger copy.
 */
export function SketchFigure({ spec, t }: SketchFigureProps) {
  const [expanded, setExpanded] = useState(false)
  useEffect(() => {
    if (!expanded) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setExpanded(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [expanded])
  return (
    <>
      <SketchPlot spec={spec} t={t} width={WIDTH} height={HEIGHT} onExpand={() => setExpanded(true)} />
      {expanded && typeof document !== 'undefined'
        ? createPortal(
          <div className={CLS.overlay} onClick={() => setExpanded(false)}>
            <div
              className={CLS.dialog}
              role="dialog"
              aria-modal="true"
              aria-label={spec.expr}
              onClick={(event) => event.stopPropagation()}
            >
              <SketchPlot
                spec={spec}
                t={t}
                width={EXPANDED_WIDTH}
                height={EXPANDED_HEIGHT}
                onClose={() => setExpanded(false)}
              />
            </div>
          </div>,
          document.body,
        )
        : null}
    </>
  )
}
