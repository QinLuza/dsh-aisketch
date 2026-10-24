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
 */

import type { CSSProperties } from 'react'
import { parseDrawPayload, resolveDrawColor } from '@aisketch/cards-core'
import type { DrawElement, DrawPaper, DrawTapeElement, DrawTextElement } from '@aisketch/cards-core'
import { renderPathElement, renderShapeElement, pixelParts, rngFor, tapePath } from './draw-engine.ts'
import type { InkPart } from './draw-engine.ts'
import { CardFrame } from './CardFrame.tsx'
import { RawCard } from './RawCard.tsx'
import type { CardRendererProps } from './registry.ts'
import { CLS } from './styles.ts'

/** Paint one part the engine produced. */
function InkPartView({ part }: { part: InkPart }) {
  if (part.kind === 'fill') {
    return <path d={part.d} style={{ fill: part.color, fillOpacity: part.opacity }} />
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
 * Draw a sketch card.
 * @param props - the admitted spec and this plugin's translate.
 * @returns the sketch, or the raw fallback when the payload is not a drawing.
 */
export function DrawCard({ card, t }: CardRendererProps) {
  const draw = parseDrawPayload(card.payload)
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
  return (
    <CardFrame
      kind={card.kind}
      title={card.title ?? t('draw.title')}
      summary={summary}
      t={t}
    >
      <div className={CLS.drawScroll}>
        <svg
          className={CLS.drawSvg}
          width={draw.size.w}
          height={draw.size.h}
          viewBox={`0 0 ${draw.size.w} ${draw.size.h}`}
          role="img"
          aria-label={summary}
        >
          <PaperDefs paper={draw.paper} />
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
      </div>
    </CardFrame>
  )
}
