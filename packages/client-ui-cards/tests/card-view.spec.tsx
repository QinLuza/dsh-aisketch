/**
 * Card view rendering.
 *
 * These render the real components to markup, so the dispatch the whole channel
 * rests on -- spec.kind through the renderer registry -- is asserted rather
 * than assumed, together with the two fallbacks that keep a bad card visible.
 * `t` is stubbed to echo its dictionary key, which keeps the assertions about
 * structure instead of copy.
 */
import { createElement } from 'react'
import type { ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CardNode } from '../src/client/CardNode.tsx'
import { CardTail } from '../src/client/CardTail.tsx'
import { TableCard } from '../src/client/TableCard.tsx'
import { registerCardRenderer } from '../src/client/registry.ts'
import type { CardRendererEntry, CardRendererProps } from '../src/client/registry.ts'

/** Echo the dictionary key so structure, not copy, is what the tests assert. */
const t = ((key: string) => `[${key}]`) as unknown as CardRendererProps['t']

/** The view as an ordinary component type, so `createElement` accepts the stub props. */
const View = CardNode as unknown as ComponentType<Record<string, unknown>>

/** Every claim this file made, released after each case. */
const claims: Array<() => void> = []

/** Claim one kind, tracked for cleanup. */
function claim(kind: string, entry: CardRendererEntry): void {
  claims.push(registerCardRenderer(kind, entry))
}

/** Render one projected node through the real view. */
function render(card: unknown, raw?: unknown): string {
  return renderToStaticMarkup(createElement(View, { node: { kind: 'card', data: { card, raw } }, t }))
}

beforeEach(() => {
  claim('table', { id: 'test', trust: 'native', component: TableCard })
})

afterEach(() => {
  for (const dispose of claims.splice(0)) dispose()
})

describe('dispatch', () => {
  it('draws a table card through the registered renderer', () => {
    const html = render({
      version: 1,
      kind: 'table',
      title: '月度收入',
      payload: { columns: ['月份', '收入'], rows: [['1月', 120], ['2月', null]] },
    })
    expect(html).toContain('data-card-kind="table"')
    expect(html).toContain('月度收入')
    expect(html).toContain('<th')
    expect(html).toContain('月份')
    expect(html).toContain('120')
    expect(html).toContain('--')
    expect(html).not.toContain('data-card-raw')
  })

  it('draws an empty table without a body row', () => {
    const html = render({ version: 1, kind: 'table', payload: { columns: ['a'] } })
    expect(html).toContain('[table.empty]')
    expect(html).toContain('[table.summary]')
  })

  it('lets a later registrant claim a kind this release does not ship', () => {
    const unclaimed = render({ version: 1, kind: 'note', payload: { text: 'hi' } })
    expect(unclaimed).toContain('[unknown.title]')
    expect(unclaimed).toContain('note')

    const Noted = (() => createElement('p', null, 'noted')) as unknown as CardRendererProps extends never ? never : ComponentType<CardRendererProps>
    claim('note', { id: 'later', trust: 'native', component: Noted })
    expect(render({ version: 1, kind: 'note', payload: { text: 'hi' } })).toContain('noted')
  })
})

describe('fallbacks', () => {
  it('shows the raw arguments of a call that never formed a card', () => {
    const html = render(null, { kind: '../escape', payload: {} })
    expect(html).toContain('data-card-raw')
    expect(html).toContain('[broken.title]')
    expect(html).toContain('../escape')
  })

  it('shows an unknown kind with its payload instead of dropping the card', () => {
    const html = render({ version: 1, kind: 'school.timetable', payload: { slots: [1] } })
    expect(html).toContain('data-card-raw')
    expect(html).toContain('school.timetable')
    expect(html).toContain('slots')
  })

  it('keeps a table the parser refuses visible as raw data', () => {
    const html = render({ version: 1, kind: 'table', payload: { columns: ['a'], rows: [['x', 'y']] } })
    expect(html).toContain('data-card-raw')
    expect(html).toContain('[broken.title]')
  })

  it('renders a call whose arguments never arrived at all', () => {
    const html = render(null, undefined)
    expect(html).toContain('data-card-raw')
    expect(html).toContain('(no arguments)')
  })
})

/** The tail as an ordinary component type, so `createElement` accepts the stub props. */
const Tail = CardTail as unknown as ComponentType<Record<string, unknown>>

/** Render the completed-Turn tail for a Turn carrying these cards. */
function renderTail(cards: readonly unknown[], seq: number): string {
  return renderToStaticMarkup(createElement(Tail, {
    turn: { data: { get: () => ({ cards }) } },
    seq,
    t,
  }))
}

/** One table card as the Turn accumulator stores it. */
function entry(callId: string, seq: number, title: string, draft = false) {
  return {
    callId,
    seq,
    card: { version: 1, kind: 'table', title, payload: { columns: ['月份', '收入'], rows: [['1月', 120]] } },
    raw: {},
    draft,
  }
}

describe('the completed-Turn tail', () => {
  it('draws a Turn card where the fold does not reach', () => {
    const html = renderTail([entry('call-1', 7, '月度收入')], 100)
    expect(html).toContain('data-card-kind="table"')
    expect(html).toContain('月度收入')
  })

  it('shows only the final card when a private draft was also recorded', () => {
    const html = renderTail([entry('draft', 5, '草稿', true), entry('call-1', 7, '定稿')], 100)
    expect(html).toContain('定稿')
    expect(html).not.toContain('草稿')
  })

  it('keeps the call order the Turn made', () => {
    const html = renderTail([entry('call-1', 7, '第一张'), entry('call-2', 11, '第二张')], 100)
    expect(html.indexOf('第一张')).toBeLessThan(html.indexOf('第二张'))
  })

  it('draws nothing before the closing reply has been reached', () => {
    expect(renderTail([entry('call-2', 120, '更晚的一张')], 100)).toBe('')
  })

  it('draws nothing for a Turn that showed no card', () => {
    expect(renderTail([], 100)).toBe('')
  })
})