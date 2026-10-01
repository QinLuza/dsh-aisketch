/**
 * The `flowchart` card: structure in, picture out.
 *
 * The model sends nodes and connections; `flowchart-layout.ts` turns that into
 * geometry and this file turns the geometry into SVG. Nothing here measures the
 * DOM, reads a global, or animates, so drawing the same payload twice yields the
 * same pixels -- which is what lets a replayed session show the identical
 * diagram without a Host call.
 *
 * A payload the parser refuses falls through to the raw card, exactly like a
 * malformed table: a refused card the model can read is a card the model can fix.
 */

import { parseFlowchartPayload } from '@gk/cards-core'
import type { CardRendererProps } from './registry.ts'
import { estimateTextWidth, LINE_HEIGHT, layoutFlowchart } from './flowchart-layout.ts'
import type { FlowchartBox } from './flowchart-layout.ts'
import { RawCard } from './RawCard.tsx'
import { CLS } from './styles.ts'

/**
 * Draw one node: its shape, then its label, centred in the frame.
 * @param props - the placed box.
 * @returns the node group.
 */
function NodeShape({ box }: { box: FlowchartBox }) {
  const centerX = box.x + box.width / 2
  const centerY = box.y + box.height / 2
  const outline = box.shape === 'decision'
    ? (
      <polygon
        className={CLS.decisionNode}
        points={`${centerX},${box.y} ${box.x + box.width},${centerY} ${centerX},${box.y + box.height} ${box.x},${centerY}`}
      />
    )
    : (
      <rect
        className={box.shape === 'terminal' ? CLS.terminalNode : CLS.processNode}
        x={box.x}
        y={box.y}
        width={box.width}
        height={box.height}
        rx={box.shape === 'terminal' ? box.height / 2 : 8}
      />
    )
  const firstLine = centerY - ((box.lines.length - 1) * LINE_HEIGHT) / 2
  return (
    <g>
      {outline}
      <text className={CLS.nodeLabel} x={centerX} y={firstLine} textAnchor="middle" dominantBaseline="central">
        {box.lines.map((line, index) => (
          <tspan key={index} x={centerX} dy={index === 0 ? 0 : LINE_HEIGHT}>{line}</tspan>
        ))}
      </text>
    </g>
  )
}

/**
 * Draw a flowchart card.
 * @param props - the admitted spec and this plugin's translate.
 * @returns the diagram card, or the raw fallback when the payload is not a diagram.
 */
export function FlowchartCard({ card, t }: CardRendererProps) {
  const flowchart = parseFlowchartPayload(card.payload)
  if (flowchart === null) {
    return (
      <RawCard
        title={t('broken.title')}
        hint={t('broken.hint')}
        kind={card.kind}
        data={card.payload}
      />
    )
  }

  const layout = layoutFlowchart(flowchart)
  const summary = t('flowchart.summary', { nodes: flowchart.nodes.length, edges: flowchart.edges.length })
  return (
    <div className={CLS.card} data-card-kind="flowchart">
      <div className={CLS.head}>
        <span className={CLS.title}>{card.title ?? t('flowchart.title')}</span>
        <span className={CLS.kind}>{card.kind}</span>
        <span className={CLS.summary}>{summary}</span>
      </div>
      <div className={CLS.scroll}>
        <svg
          className={CLS.chart}
          width={layout.width}
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          role="img"
          aria-label={summary}
        >
          {layout.arrows.map((arrow, index) => (
            <g key={index}>
              <path className={CLS.edge} d={arrow.d} />
              <polygon className={CLS.edgeHead} points={arrow.head} />
              {arrow.label === undefined ? null : (
                <g>
                  <rect
                    className={CLS.edgeLabelBackground}
                    x={arrow.labelX - estimateTextWidth(arrow.label) / 2 - 4}
                    y={arrow.labelY - 9}
                    width={estimateTextWidth(arrow.label) + 8}
                    height={18}
                    rx={4}
                  />
                  <text
                    className={CLS.edgeLabel}
                    x={arrow.labelX}
                    y={arrow.labelY}
                    textAnchor="middle"
                    dominantBaseline="central"
                  >
                    {arrow.label}
                  </text>
                </g>
              )}
            </g>
          ))}
          {layout.boxes.map((box) => <NodeShape key={box.id} box={box} />)}
        </svg>
      </div>
    </div>
  )
}
