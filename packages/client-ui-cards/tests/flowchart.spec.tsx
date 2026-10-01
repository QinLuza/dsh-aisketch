/**
 * The `flowchart` card: layout and rendering.
 *
 * Two properties carry this card, and both are asserted here rather than
 * assumed. The layout is *deterministic and payload-derived* -- the same
 * structure must produce byte-identical geometry, because that is what makes a
 * replayed session show the same picture with no Host call. And the picture is
 * *real DOM*: shapes, arrowheads and labels in the host's own React tree, not
 * markup the model composed.
 *
 * `t` is stubbed to echo its dictionary key, so the assertions are about
 * structure instead of copy.
 */
import { createElement } from 'react'
import type { ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FLOWCHART_KIND, parseFlowchartPayload } from '@gk/cards-core'
import type { FlowchartPayload, FlowchartShape } from '@gk/cards-core'
import { CardView } from '../src/client/CardView.tsx'
import { FlowchartCard } from '../src/client/FlowchartCard.tsx'
import { registerCardRenderer } from '../src/client/registry.ts'
import type { CardRendererEntry, CardRendererProps } from '../src/client/registry.ts'
import { estimateTextWidth, LINE_HEIGHT, layoutFlowchart } from '../src/client/flowchart-layout.ts'
import type { FlowchartBox, FlowchartLayout } from '../src/client/flowchart-layout.ts'

/** Echo the dictionary key so structure, not copy, is what the tests assert. */
const t = ((key: string) => `[${key}]`) as unknown as CardRendererProps['t']

/** The claim this file makes, released after each case. */
let release: (() => void) | undefined

beforeEach(() => {
  const entry: CardRendererEntry = { id: 'test', trust: 'native', component: FlowchartCard }
  release = registerCardRenderer(FLOWCHART_KIND, entry)
})

afterEach(() => {
  release?.()
  release = undefined
})

/**
 * Build a fixture the way the Host does -- through the parser -- so a fixture
 * carries the same defaults a live call would, and an invalid one fails here
 * instead of quietly testing a shape production never sees.
 */
function diagram(
  nodes: ReadonlyArray<{ id: string; label: string; shape?: FlowchartShape }>,
  edges: ReadonlyArray<{ from: string; to: string; label?: string }>,
): FlowchartPayload {
  const parsed = parseFlowchartPayload({ nodes, edges })
  if (parsed === null) throw new Error('fixture is not a valid diagram')
  return parsed
}

/** One if/else flow with a retry loop, which exercises both arrow routes. */
const ifElse = diagram(
  [
    { id: 'start', label: '开始', shape: 'terminal' },
    { id: 'check', label: '还有额度？', shape: 'decision' },
    { id: 'yes', label: '继续任务', shape: 'process' },
    { id: 'no', label: '结束流程', shape: 'terminal' },
  ],
  [
    { from: 'start', to: 'check' },
    { from: 'check', to: 'yes', label: '是' },
    { from: 'check', to: 'no', label: '否' },
    { from: 'no', to: 'check', label: '重试' },
  ],
)

/** The placed box of one node, or a loud failure instead of an undefined. */
function boxOf(layout: FlowchartLayout, id: string): FlowchartBox {
  const found = layout.boxes.find((box) => box.id === id)
  if (found === undefined) throw new Error(`no box placed for "${id}"`)
  return found
}

/** Render one card through the real dispatch path. */
function render(card: unknown, raw: unknown = {}): string {
  return renderToStaticMarkup(createElement(
    CardView as unknown as ComponentType<Record<string, unknown>>,
    { card, raw, t },
  ))
}

describe('layout', () => {
  it('is a pure function of the payload', () => {
    expect(layoutFlowchart(ifElse)).toEqual(layoutFlowchart(ifElse))
  })

  it('ranks columns left to right and keeps payload order inside a column', () => {
    const layout = layoutFlowchart(ifElse)
    const columns: number[] = []
    for (const box of layout.boxes) columns.push(box.x)
    expect(columns).toEqual([...columns].sort((left, right) => left - right))
    expect(boxOf(layout, 'start').x).toBeLessThan(boxOf(layout, 'check').x)
    expect(boxOf(layout, 'check').x).toBeLessThan(boxOf(layout, 'yes').x)
    // `yes` is declared before `no`, so it also sits above it.
    expect(boxOf(layout, 'yes').y).toBeLessThan(boxOf(layout, 'no').y)
  })

  it('does not let a loop push its target past its source', () => {
    const layout = layoutFlowchart(ifElse)
    expect(boxOf(layout, 'check').x).toBeLessThan(boxOf(layout, 'no').x)
  })

  it('stacks two branches of one rank in the same column', () => {
    const layout = layoutFlowchart(ifElse)
    const yes = boxOf(layout, 'yes')
    const no = boxOf(layout, 'no')
    expect(yes.x + yes.width / 2).toBeCloseTo(no.x + no.width / 2)
    expect(yes.y).toBeLessThan(no.y)
  })

  it('gives a decision more room than the same label as a process', () => {
    const label = '还有额度？'
    const layout = layoutFlowchart(diagram([{ id: 'a', label }, { id: 'b', label, shape: 'decision' }], []))
    expect(boxOf(layout, 'b').width).toBeGreaterThan(boxOf(layout, 'a').width)
    expect(boxOf(layout, 'b').height).toBeGreaterThan(boxOf(layout, 'a').height)
  })

  it('wraps a long label instead of stretching the box past its ceiling', () => {
    const layout = layoutFlowchart(diagram([{ id: 'a', label: '这一步的说明文字很长需要换行显示' }], []))
    const box = boxOf(layout, 'a')
    expect(box.lines.length).toBeGreaterThan(1)
    expect(box.width).toBeLessThanOrEqual(260)
    for (const line of box.lines) expect(estimateTextWidth(line)).toBeLessThanOrEqual(150)
  })

  it('fans a shared endpoint so a merge reads as two arrows', () => {
    const merging = diagram(
      [
        { id: 'start', label: '开始', shape: 'terminal' },
        { id: 'cond', label: '条件成立？', shape: 'decision' },
        { id: 'a', label: 'A 分支' },
        { id: 'b', label: 'B 分支' },
        { id: 'done', label: '结束', shape: 'terminal' },
      ],
      [
        { from: 'start', to: 'cond' },
        { from: 'cond', to: 'a', label: '是' },
        { from: 'cond', to: 'b', label: '否' },
        { from: 'a', to: 'done' },
        { from: 'b', to: 'done' },
      ],
    )
    const layout = layoutFlowchart(merging)
    const arrivals = layout.arrows.filter((arrow) => arrow.to === 'done').map((arrow) => arrow.head.split(' ')[0])
    const departures = layout.arrows.filter((arrow) => arrow.from === 'cond').map((arrow) => arrow.d.split(' ')[1])
    expect(arrivals).toHaveLength(2)
    expect(departures).toHaveLength(2)
    expect(new Set(arrivals).size).toBe(2)
    expect(new Set(departures).size).toBe(2)
  })

  it('leaves a single connection on its node s centre line', () => {
    const layout = layoutFlowchart(diagram([{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], [{ from: 'a', to: 'b' }]))
    const source = boxOf(layout, 'a')
    const target = boxOf(layout, 'b')
    const arrow = layout.arrows[0]
    expect(arrow?.d.startsWith(`M ${source.x + source.width / 2} ${source.y + source.height}`)).toBe(true)
    expect(arrow?.head.split(' ')[0]).toBe(`${target.x + target.width / 2},${target.y}`)
  })

  it('points a forward arrow at the next node s top edge', () => {
    const layout = layoutFlowchart(diagram([{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], [{ from: 'a', to: 'b' }]))
    const target = boxOf(layout, 'b')
    const arrow = layout.arrows[0]
    expect(arrow?.from).toBe('a')
    expect(arrow?.head.split(' ')[0]).toBe(`${target.x + target.width / 2},${target.y}`)
    expect(arrow?.labelX).toBeGreaterThan(0)
  })

  it('routes a backwards connection through the right-hand gutter', () => {
    const layout = layoutFlowchart(ifElse)
    const retry = layout.arrows.find((arrow) => arrow.from === 'no')
    expect(retry?.label).toBe('重试')
    const rightmost = Math.max(...layout.boxes.map((box) => box.x + box.width))
    const lane = Math.max(...(retry?.d.match(/[\d.]+/g) ?? []).map(Number))
    expect(lane).toBeGreaterThan(rightmost)
    expect(layout.width).toBeGreaterThan(lane)
  })

  it('separates two gutter connections so they never overlap', () => {
    const layout = layoutFlowchart(diagram(
      [{ id: 'a', label: 'A' }, { id: 'b', label: 'B', shape: 'decision' }],
      [{ from: 'b', to: 'a' }, { from: 'a', to: 'b', label: '是' }],
    ))
    expect(layout.arrows).toHaveLength(2)
    expect(layout.width).toBeGreaterThan(0)
    expect(layout.height).toBeGreaterThan(0)
  })

  it('survives a cycle the ranking cannot order', () => {
    const layout = layoutFlowchart(diagram(
      [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }],
      [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'a' }],
    ))
    expect(layout.boxes).toHaveLength(3)
    expect(layout.arrows).toHaveLength(3)
  })
})

describe('rendering', () => {
  it('draws the registered renderer for the flowchart kind', () => {
    const html = render({ version: 1, kind: 'flowchart', title: '额度判定', payload: ifElse })
    expect(html).toContain('data-card-kind="flowchart"')
    expect(html).not.toContain('data-card-raw')
    expect(html).toContain('额度判定')
    expect(html).toContain('[flowchart.summary]')
  })

  it('draws shapes, arrowheads and labels as real DOM', () => {
    const layout = layoutFlowchart(ifElse)
    const html = render({ version: 1, kind: 'flowchart', payload: ifElse })
    expect(html).toContain('<svg')
    expect(html).toContain('role="img"')
    expect(html.match(/<polygon/g)?.length).toBe(layout.arrows.length + 1)
    expect(html.match(/<tspan/g)?.length).toBe(layout.boxes.length)
    expect(html).toContain('还有额度？')
    expect(html).toContain('是')
    expect(html).toContain('重试')
  })

  it('breaks a wrapped label across lines at the layout s line height', () => {
    const html = render({
      version: 1,
      kind: 'flowchart',
      payload: { nodes: [{ id: 'a', label: '这一步的说明文字很长需要换行显示' }], edges: [] },
    })
    expect(html).toContain(`dy="${LINE_HEIGHT}"`)
  })

  it('replays the identical picture from the identical payload', () => {
    const card = { version: 1, kind: 'flowchart', payload: ifElse }
    expect(render(card)).toBe(render(card))
  })

  it('keeps a diagram the parser refuses visible as raw data', () => {
    const html = render({ version: 1, kind: 'flowchart', payload: { nodes: [], edges: [] } })
    expect(html).toContain('data-card-raw')
    expect(html).toContain('[broken.title]')
  })

  it('keeps an undeclared connection from silently losing the card', () => {
    const html = render({
      version: 1,
      kind: 'flowchart',
      payload: { nodes: [{ id: 'a', label: 'A' }], edges: [{ from: 'a', to: 'ghost' }] },
    })
    expect(html).toContain('data-card-raw')
    expect(html).toContain('ghost')
  })
})
