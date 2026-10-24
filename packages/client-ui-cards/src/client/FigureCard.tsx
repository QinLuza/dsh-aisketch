/**
 * The semantic teaching-figure card.
 *
 * The model supplies a template and its parameters; this renderer owns the
 * geometry, tokens, labels and arrows. There is deliberately no freehand ink,
 * tape or handwriting here: a scientific figure has to be reproducible and
 * readable in monochrome, not charming.
 */

import { parseFigurePayload } from '@aisketch/cards-core'
import { CardFrame } from './CardFrame.tsx'
import { RawCard } from './RawCard.tsx'
import type { CardRendererProps } from './registry.ts'
import { CLS } from './styles.ts'
import {
  FIGURE_FONT_FAMILY,
  FIGURE_HEIGHT,
  FIGURE_PALETTE,
  FIGURE_WIDTH,
  buildAtomShellLayout,
  buildConnectedBodiesLayout,
  buildInclineForceLayout,
  buildOrbitalDiagramLayout,
} from './figure-geometry.ts'
import type { FigureLayout, FigurePrimitive } from './figure-geometry.ts'

/** Map a paint role to its concrete token. */
function paint(color: keyof typeof FIGURE_PALETTE): string {
  return FIGURE_PALETTE[color]
}

/** The three arrowheads used by a figure. */
function ArrowDefs() {
  return (
    <defs>
      {(['ink', 'muted', 'accent'] as const).map(color => (
        <marker
          key={color}
          id={`cd-figure-arrow-${color}`}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 Z" fill={paint(color)} />
        </marker>
      ))}
    </defs>
  )
}

/** Render one geometry primitive. */
function Primitive({ primitive }: { primitive: FigurePrimitive }) {
  if (primitive.kind === 'line') {
    return (
      <line
        x1={primitive.x1}
        y1={primitive.y1}
        x2={primitive.x2}
        y2={primitive.y2}
        style={{
          stroke: paint(primitive.color),
          strokeWidth: primitive.width,
          strokeLinecap: 'round',
          ...primitive.dash === undefined ? {} : { strokeDasharray: primitive.dash },
        }}
        markerEnd={primitive.marker === true ? `url(#cd-figure-arrow-${primitive.color})` : undefined}
        data-role={primitive.role}
      />
    )
  }
  if (primitive.kind === 'polygon') {
    return (
      <polygon
        points={primitive.points.map(point => `${point.x},${point.y}`).join(' ')}
        style={{
          fill: primitive.fill === undefined ? 'none' : paint(primitive.fill),
          stroke: primitive.stroke === undefined ? 'none' : paint(primitive.stroke),
          strokeWidth: primitive.width ?? 1,
          strokeLinejoin: 'round',
        }}
      />
    )
  }
  if (primitive.kind === 'circle') {
    return (
      <circle
        cx={primitive.cx}
        cy={primitive.cy}
        r={primitive.r}
        style={{
          fill: primitive.fill === undefined ? 'none' : paint(primitive.fill),
          stroke: primitive.stroke === undefined ? 'none' : paint(primitive.stroke),
          strokeWidth: primitive.width ?? 1,
        }}
      />
    )
  }
  if (primitive.kind === 'path') {
    return (
      <path
        d={primitive.d}
        style={{
          fill: primitive.fill === undefined ? 'none' : paint(primitive.fill),
          stroke: primitive.stroke === undefined ? 'none' : paint(primitive.stroke),
          strokeWidth: primitive.width ?? 1,
          strokeLinecap: 'round',
          ...primitive.dash === undefined ? {} : { strokeDasharray: primitive.dash },
        }}
      />
    )
  }
  return (
    <text
      x={primitive.x}
      y={primitive.y}
      textAnchor={primitive.anchor ?? 'start'}
      style={{
        fill: paint(primitive.color),
        fontFamily: FIGURE_FONT_FAMILY,
        fontSize: primitive.size,
        ...primitive.weight === undefined ? {} : { fontWeight: primitive.weight },
      }}
    >
      {primitive.text}
    </text>
  )
}

/** One deterministic figure on a plain scientific surface. */
function FigureSvg({ layout }: { layout: FigureLayout }) {
  return (
    <svg
      className={CLS.figureSvg}
      width={layout.width}
      height={layout.height}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      role="img"
      aria-label={layout.ariaLabel}
    >
      <ArrowDefs />
      <rect x={0} y={0} width={layout.width} height={layout.height} fill={paint(layout.background)} />
      {layout.primitives.map((primitive, index) => <Primitive key={index} primitive={primitive} />)}
    </svg>
  )
}

/**
 * Draw a teaching figure, or the raw fallback when the payload is not one.
 * @param props - admitted card and translator.
 * @returns the figure card.
 */
export function FigureCard({ card, t }: CardRendererProps) {
  const figure = parseFigurePayload(card.payload)
  if (figure === null) {
    return (
      <RawCard
        title={t('broken.title')}
        hint={t('broken.hint')}
        kind={card.kind}
        data={card.payload}
      />
    )
  }
  const layout = figure.template === 'incline_force'
    ? buildInclineForceLayout(figure.params)
    : figure.template === 'connected_bodies'
      ? buildConnectedBodiesLayout(figure.params)
      : figure.template === 'orbital_diagram'
        ? buildOrbitalDiagramLayout(figure.params)
        : buildAtomShellLayout(figure.params)
  return (
    <CardFrame
      kind={card.kind}
      title={card.title ?? t('figure.title')}
      summary={figure.template === 'incline_force'
        ? t('figure.summary.incline', {
          angle: figure.params.angleDeg,
          mass: figure.params.massKg,
          friction: figure.params.frictionCoeff,
        })
        : figure.template === 'connected_bodies'
          ? t('figure.summary.connected', {
            surface: figure.params.surfaceMassKg,
            hanging: figure.params.hangingMassKg,
            friction: figure.params.frictionCoeff,
          })
          : figure.template === 'orbital_diagram'
            ? t('figure.summary.orbital', {
              symbol: figure.params.symbol,
              z: figure.params.atomicNumber,
            })
            : t('figure.summary.atom', {
              symbol: figure.params.symbol,
              z: figure.params.atomicNumber,
            })}
      t={t}
    >
      <div className={CLS.figureScroll}>
        <FigureSvg layout={layout} />
      </div>
    </CardFrame>
  )
}
