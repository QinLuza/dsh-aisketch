/**
 * The `draw` card: a hand-drawn sketch, note-app style.
 *
 * The model ships elements (pen paths, shapes, text, tape); `draw-engine.ts`
 * turns every element into paint instructions deterministically, so drawing
 * the same payload twice yields the same pixels -- which is what lets a
 * replayed session show the identical sketch without a Host call.
 *
 * Paint goes through inline `style` rather than SVG presentation attributes on
 * purpose: theme ink arrives as `var(--dsw-alias-*)`, which browsers do not
 * resolve inside a presentation attribute, while inline CSS does.
 *
 * The picture is rasterized once and shown as a canvas. A drawn card is
 * hundreds of paths, some with filters and gradients; leaving that as live SVG
 * makes every scroll past it and every expand pay a cold rasterization. The SVG
 * is mounted hidden, photographed, and dropped -- the canvas is what the page
 * ever paints.
 */

import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { parseDrawPayload, resolveDrawColor } from '@aisketch/cards-core'
import type { DrawElement, DrawPaper, DrawTapeElement, DrawTextElement } from '@aisketch/cards-core'
import { renderPathElement, renderShapeElement, pixelParts, rngFor, tapePath } from './draw-engine.ts'
import type { InkGradient, InkPart } from './draw-engine.ts'
import { CardFrame } from './CardFrame.tsx'
import { RawCard } from './RawCard.tsx'
import type { CardRendererProps } from './registry.ts'
import { cachedSnapshot, snapshotFor, storeSnapshot } from './snapshot.ts'
import { CLS } from './styles.ts'

/**
 * Font stacks are inlined on text elements, not left to a class.
 *
 * The snapshot serializes the SVG into an image document, where page classes do
 * not apply: a `font-family: inherit` label would silently become Times. The
 * live SVG uses the same inline stack, so both look identical.
 */
const HAND_FONT = "'Segoe Script', 'Comic Sans MS', 'KaiTi', '楷体', 'Kaiti SC', 'STKaiti', cursive"
const UI_FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif'

/**
 * A gradient's id, derived from the gradient itself.
 *
 * Two identical gradients may share an id because their definitions are also
 * identical, and a replayed session produces the same ids -- which is what keeps
 * the card a function of its payload rather than of render order or a counter.
 */
function gradientId(gradient: InkGradient): string {
  const geometry = [gradient.x1, gradient.y1, gradient.x2, gradient.y2, gradient.cx, gradient.cy, gradient.r]
    .map(value => Math.round(value * 10))
    .join('_')
  const stops = gradient.stops
    .map(stop => `${Math.round(stop.offset * 100)}-${stop.color}-${Math.round(stop.opacity * 100)}`)
    .join('_')
  return `cdg-${gradient.type}-${geometry}-${stops}`.replace(/[^a-zA-Z0-9_-]/gu, '')
}

/** One gradient definition, emitted next to the path that uses it. */
function GradientDef({ id, gradient }: { id: string; gradient: InkGradient }) {
  const stops = gradient.stops.map((stop, index) => (
    <stop key={index} offset={stop.offset} stopColor={stop.color} stopOpacity={stop.opacity} />
  ))
  if (gradient.type === 'linear') {
    return (
      <defs>
        <linearGradient
          id={id}
          gradientUnits="userSpaceOnUse"
          x1={gradient.x1}
          y1={gradient.y1}
          x2={gradient.x2}
          y2={gradient.y2}
        >
          {stops}
        </linearGradient>
      </defs>
    )
  }
  return (
    <defs>
      <radialGradient id={id} gradientUnits="userSpaceOnUse" cx={gradient.cx} cy={gradient.cy} r={gradient.r}>
        {stops}
      </radialGradient>
    </defs>
  )
}

/** The style every painted part shares: blend mode and softening, when asked for. */
function blendStyle(part: InkPart): CSSProperties {
  const style: CSSProperties = {}
  if (part.blend !== 'normal') style.mixBlendMode = part.blend
  // The payload's blur is the visible spread; CSS blur() is a Gaussian stdDeviation.
  if (part.blur > 0) style.filter = `blur(${part.blur / 2}px)`
  return style
}

/** Paint one part the engine produced. */
function InkPartView({ part }: { part: InkPart }) {
  if (part.kind === 'fill') {
    if (part.gradient === undefined) {
      return <path d={part.d} style={{ fill: part.color, fillOpacity: part.opacity, ...blendStyle(part) }} />
    }
    const id = gradientId(part.gradient)
    return (
      <>
        <GradientDef id={id} gradient={part.gradient} />
        <path d={part.d} style={{ fill: `url(#${id})`, fillOpacity: part.opacity, ...blendStyle(part) }} />
      </>
    )
  }
  return (
    <path
      d={part.d}
      style={{
        fill: 'none',
        stroke: part.color,
        strokeWidth: part.width,
        strokeOpacity: part.opacity,
        strokeLinecap: part.cap,
        strokeLinejoin: 'round',
        ...(part.dasharray === undefined ? {} : { strokeDasharray: part.dasharray }),
        ...blendStyle(part),
      }}
    />
  )
}

/** One text element, one line per `\n`. */
function DrawText({ element }: { element: DrawTextElement }) {
  const lines = element.text.split('\n')
  const style: CSSProperties = {
    fill: resolveDrawColor(element.color),
    fontSize: element.size,
    fontWeight: element.bold ? 700 : 400,
    fontFamily: element.hand ? HAND_FONT : UI_FONT,
  }
  return (
    <text
      className={element.hand ? CLS.drawHand : CLS.drawText}
      x={element.x}
      y={element.y}
      style={style}
      textAnchor={element.anchor}
    >
      {lines.map((line, index) => (
        <tspan key={index} x={element.x} dy={index === 0 ? 0 : element.size * 1.35}>{line}</tspan>
      ))}
    </text>
  )
}

/** One strip of tape, rotated around its own centre. */
function DrawTape({ element, rng }: { element: DrawTapeElement; rng: () => number }) {
  const centreX = element.x + element.w / 2
  const centreY = element.y + element.h / 2
  return (
    <path
      d={tapePath(element, rng)}
      transform={`rotate(${element.angle} ${centreX} ${centreY})`}
      style={{ fill: resolveDrawColor(element.color ?? 'yellow'), fillOpacity: 0.42 }}
    />
  )
}

/** One element, whichever kind it is. The seed is its index, so wobble is stable. */
function DrawElementView({ element, index }: { element: DrawElement; index: number }) {
  const rng = rngFor(index + 1)
  if (element.type === 'path') {
    const parts = renderPathElement(element, rng)
    return <>{parts.map((part, partIndex) => <InkPartView key={partIndex} part={part} />)}</>
  }
  if (element.type === 'shape') {
    const parts = renderShapeElement(element, rng)
    return <>{parts.map((part, partIndex) => <InkPartView key={partIndex} part={part} />)}</>
  }
  if (element.type === 'pixels') {
    const parts = pixelParts(element)
    return <>{parts.map((part, partIndex) => <InkPartView key={partIndex} part={part} />)}</>
  }
  if (element.type === 'text') return <DrawText element={element} />
  return <DrawTape element={element} rng={rng} />
}

/**
 * Paper pattern definitions. Ids are page-global; identical ids across cards
 * are harmless because the definitions are identical.
 */
function PaperDefs({ paper }: { paper: DrawPaper }) {
  if (paper === 'plain') return null
  if (paper === 'dots') {
    return (
      <defs>
        <pattern id="cd-draw-paper-dots" width="22" height="22" patternUnits="userSpaceOnUse">
          <circle
            cx="11"
            cy="11"
            r="1.1"
            style={{ fill: 'var(--dsw-alias-border-base, rgba(0, 0, 0, 0.12))', fillOpacity: 0.7 }}
          />
        </pattern>
      </defs>
    )
  }
  if (paper === 'grid') {
    return (
      <defs>
        <pattern id="cd-draw-paper-grid" width="22" height="22" patternUnits="userSpaceOnUse">
          <path
            d="M 22 0 L 0 0 0 22"
            style={{
              fill: 'none',
              stroke: 'var(--dsw-alias-border-base, rgba(0, 0, 0, 0.12))',
              strokeWidth: 1,
              strokeOpacity: 0.55,
            }}
          />
        </pattern>
      </defs>
    )
  }
  return (
    <defs>
      <pattern id="cd-draw-paper-lined" width="8" height="26" patternUnits="userSpaceOnUse">
        <path
          d="M 0 13 H 8"
          style={{
            fill: 'none',
            stroke: 'var(--dsw-alias-border-base, rgba(0, 0, 0, 0.12))',
            strokeWidth: 1,
            strokeOpacity: 0.55,
          }}
        />
      </pattern>
    </defs>
  )
}

/**
 * The colors a snapshot bakes in: theme ink and paper rule, plus the scheme.
 * @returns a value that changes only when the page's palette actually changes.
 */
function themeSignature(): string {
  if (typeof window === 'undefined') return ''
  const style = window.getComputedStyle(document.documentElement)
  return [
    style.getPropertyValue('--dsw-alias-text-primary'),
    style.getPropertyValue('--dsw-alias-border-base'),
    style.colorScheme,
  ].join('|')
}

/**
 * Watch for a real theme change, not for every class the shell touches.
 *
 * A mutation observer fires on unrelated attribute churn (a streaming state
 * class, a font-size tweak); re-snapshotting on those would burn the very cost
 * this file exists to avoid, so the palette itself is the only trigger.
 * @returns the palette signature.
 */
function useThemeSignature(): string {
  const [signature, setSignature] = useState(themeSignature)
  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return
    const check = (): void => {
      setSignature(current => {
        const next = themeSignature()
        return next === current ? current : next
      })
    }
    const observer = new MutationObserver(check)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] })
    if (document.body !== null) {
      observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] })
    }
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', check)
    return () => {
      observer.disconnect()
      media.removeEventListener('change', check)
    }
  }, [])
  return signature
}

/** Copy a cached bitmap into this instance's own canvas. */
function SnapshotCanvas({ source, label }: { source: HTMLCanvasElement; label: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    const canvas = ref.current
    if (canvas === null) return
    const context = canvas.getContext('2d')
    if (context === null) return
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.drawImage(source, 0, 0)
  }, [source])
  return (
    <canvas
      ref={ref}
      className={CLS.drawCanvas}
      width={source.width}
      height={source.height}
      role="img"
      aria-label={label}
    />
  )
}

/**
 * Draw a sketch card.
 * @param props - the admitted spec and this plugin's translate.
 * @returns the sketch, or the raw fallback when the payload is not a drawing.
 */
export function DrawCard({ card, t }: CardRendererProps) {
  const draw = parseDrawPayload(card.payload)
  const theme = useThemeSignature()
  const [svgNode, setSvgNode] = useState<SVGSVGElement | null>(null)
  const [snapshot, setSnapshot] = useState<HTMLCanvasElement | null>(null)
  const [failed, setFailed] = useState(false)
  const cacheKey = draw === null
    ? ''
    : `${theme}|${draw.size.w}x${draw.size.h}|${draw.paper}|${draw.background ?? ''}|${JSON.stringify(draw.elements)}`

  // A new key means a new picture: drop the old bitmap and show the SVG again.
  useEffect(() => {
    setSnapshot(cachedSnapshot(cacheKey) ?? null)
    setFailed(false)
  }, [cacheKey])

  useEffect(() => {
    if (draw === null || svgNode === null || failed) return
    if (cachedSnapshot(cacheKey) !== undefined) return
    let alive = true
    snapshotFor(cacheKey, svgNode, window.devicePixelRatio || 1)
      .then((canvas) => {
        if (!alive) return
        storeSnapshot(cacheKey, canvas)
        setSnapshot(canvas)
      })
      .catch(() => {
        if (alive) setFailed(true)
      })
    return () => {
      alive = false
    }
  }, [cacheKey, svgNode, failed, draw])

  if (draw === null) {
    return (
      <RawCard
        title={t('broken.title')}
        hint={t('broken.hint')}
        kind={card.kind}
        data={card.payload}
      />
    )
  }

  const summary = t('draw.summary', { elements: draw.elements.length, w: draw.size.w, h: draw.size.h })

  const artwork = (hidden: boolean) => (
    <svg
      ref={setSvgNode}
      className={CLS.drawSvg}
      width={draw.size.w}
      height={draw.size.h}
      viewBox={`0 0 ${draw.size.w} ${draw.size.h}`}
      role={hidden ? undefined : 'img'}
      aria-hidden={hidden ? true : undefined}
      aria-label={hidden ? undefined : summary}
      style={hidden ? { display: 'none' } : undefined}
    >
      <PaperDefs paper={draw.paper} />
      {draw.background === undefined
        ? null
        : (
          <rect
            x={0}
            y={0}
            width={draw.size.w}
            height={draw.size.h}
            style={{ fill: resolveDrawColor(draw.background) }}
          />
        )}
      {draw.paper === 'plain'
        ? null
        : (
          <rect
            x={0}
            y={0}
            width={draw.size.w}
            height={draw.size.h}
            fill={`url(#cd-draw-paper-${draw.paper})`}
          />
        )}
      {draw.elements.map((element, index) => <DrawElementView key={index} element={element} index={index} />)}
    </svg>
  )

  return (
    <CardFrame
      kind={card.kind}
      title={card.title ?? t('draw.title')}
      summary={summary}
      t={t}
    >
      <div className={CLS.drawScroll}>
        {snapshot !== null
          ? <SnapshotCanvas source={snapshot} label={summary} />
          : failed
            ? artwork(false)
            : (
              <>
                {artwork(true)}
                <div className={CLS.drawPlaceholder} style={{ aspectRatio: `${draw.size.w} / ${draw.size.h}` }} />
              </>
            )}
      </div>
    </CardFrame>
  )
}
