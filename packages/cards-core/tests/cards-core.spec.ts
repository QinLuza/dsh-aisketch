import { describe, expect, it } from 'vitest'
import {
  CARD_SPEC_VERSION, MAX_FLOWCHART_EDGES, MAX_FLOWCHART_LABEL_LENGTH, MAX_FLOWCHART_NODES,
  MAX_KIND_LENGTH, MAX_PAYLOAD_LENGTH, MAX_TABLE_COLUMNS, MAX_TABLE_ROWS,
  parseCardSpec, parseFlowchartPayload, parseTablePayload, readCardEnvelope, summarizeCard, validateCardArgs,
} from '../src/index.ts'

/** A minimal admitted card. */
const table = (payload: unknown, title?: unknown): Record<string, unknown> => ({
  kind: 'table',
  ...title === undefined ? {} : { title },
  payload,
})

describe('readCardEnvelope', () => {
  it('admits an unknown kind and stamps the current version', () => {
    const result = readCardEnvelope({ kind: 'gantt', title: '  Roadmap  ', payload: { tasks: [] } })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.card).toEqual({ version: CARD_SPEC_VERSION, kind: 'gantt', title: 'Roadmap', payload: { tasks: [] } })
  })

  it('omits title entirely when absent or blank, so the spec stays round-trip exact', () => {
    for (const title of [undefined, null, '', '   ']) {
      const result = readCardEnvelope({ kind: 'note', title, payload: {} })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect('title' in result.card).toBe(false)
      expect(Object.keys(result.card)).toEqual(['version', 'kind', 'payload'])
    }
  })

  it.each([
    ['missing kind', { payload: {} }],
    ['numeric kind', { kind: 7, payload: {} }],
    ['blank kind', { kind: '   ', payload: {} }],
    ['over-long kind', { kind: `a${'b'.repeat(MAX_KIND_LENGTH)}`, payload: {} }],
    ['path-like kind', { kind: '../evil', payload: {} }],
    ['leading digit', { kind: '9lives', payload: {} }],
    ['space inside', { kind: 'two words', payload: {} }],
    ['missing payload', { kind: 'note' }],
    ['array payload', { kind: 'note', payload: [] }],
    ['scalar payload', { kind: 'note', payload: 'x' }],
    ['numeric title', { kind: 'note', title: 5, payload: {} }],
    ['over-long title', { kind: 'note', title: 'x'.repeat(201), payload: {} }],
    ['not an object', 'card'],
    ['null', null],
  ])('refuses %s', (_label, value) => {
    expect(readCardEnvelope(value).ok).toBe(false)
  })

  it('refuses a payload past the serialized ceiling', () => {
    const result = readCardEnvelope({ kind: 'note', payload: { blob: 'x'.repeat(MAX_PAYLOAD_LENGTH) } })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('payload must serialize')
  })

  it('refuses a circular payload instead of throwing', () => {
    const payload: Record<string, unknown> = {}
    payload.self = payload
    expect(readCardEnvelope({ kind: 'note', payload }).ok).toBe(false)
  })
})

describe('table payload', () => {
  it('parses a header with rows and defaults rows to empty', () => {
    const parsed = parseTablePayload({ columns: ['月份', '收入'], rows: [['1月', 120], ['2月', null]] })
    expect(parsed).toEqual({ columns: ['月份', '收入'], rows: [['1月', 120], ['2月', null]] })
    expect(parseTablePayload({ columns: ['a'] })).toEqual({ columns: ['a'], rows: [] })
  })

  it.each([
    ['no columns', { columns: [] }],
    ['too many columns', { columns: Array.from({ length: MAX_TABLE_COLUMNS + 1 }, (_v, i) => `c${i}`) }],
    ['non-string column', { columns: [1] }],
    ['blank column', { columns: ['  '] }],
    ['rows not an array', { columns: ['a'], rows: {} }],
    ['too many rows', { columns: ['a'], rows: Array.from({ length: MAX_TABLE_ROWS + 1 }, () => ['x']) }],
    ['wide row', { columns: ['a'], rows: [['x', 'y']] }],
    ['object cell', { columns: ['a'], rows: [[{ v: 1 }]] }],
    ['row not an array', { columns: ['a'], rows: ['x'] }],
  ])('refuses %s', (_label, payload) => {
    expect(parseTablePayload(payload)).toBeNull()
  })

  it('is refused by validateCardArgs with the payload reason', () => {
    const result = validateCardArgs(table({ columns: ['a'], rows: [[1, 2]] }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('one per column')
  })
})

describe('flowchart payload', () => {
  /** One admissible if/else diagram, reused by the cases below. */
  const ifElse = {
    nodes: [
      { id: 'start', label: '开始', shape: 'terminal' },
      { id: 'check', label: '还有额度？', shape: 'decision' },
      { id: 'yes', label: '继续任务' },
      { id: 'no', label: '结束', shape: 'terminal' },
    ],
    edges: [
      { from: 'start', to: 'check' },
      { from: 'check', to: 'yes', label: '是' },
      { from: 'check', to: 'no', label: '否' },
    ],
  }

  it('parses nodes and connections, defaulting an omitted shape to process', () => {
    expect(parseFlowchartPayload(ifElse)).toEqual({
      nodes: [
        { id: 'start', label: '开始', shape: 'terminal' },
        { id: 'check', label: '还有额度？', shape: 'decision' },
        { id: 'yes', label: '继续任务', shape: 'process' },
        { id: 'no', label: '结束', shape: 'terminal' },
      ],
      edges: [
        { from: 'start', to: 'check' },
        { from: 'check', to: 'yes', label: '是' },
        { from: 'check', to: 'no', label: '否' },
      ],
    })
  })

  it('defaults connections to empty, so a single node is a legal diagram', () => {
    expect(parseFlowchartPayload({ nodes: [{ id: 'only', label: '一步' }] }))
      .toEqual({ nodes: [{ id: 'only', label: '一步', shape: 'process' }], edges: [] })
  })

  it('drops a blank connection label instead of drawing an empty chip', () => {
    const parsed = parseFlowchartPayload({
      nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
      edges: [{ from: 'a', to: 'b', label: '' }],
    })
    expect(parsed?.edges).toEqual([{ from: 'a', to: 'b' }])
  })

  it.each([
    ['no nodes array', { edges: [] }],
    ['empty nodes', { nodes: [] }],
    ['too many nodes', { nodes: Array.from({ length: MAX_FLOWCHART_NODES + 1 }, (_v, i) => ({ id: `n${i}`, label: 'x' })) }],
    ['node not an object', { nodes: ['start'] }],
    ['missing id', { nodes: [{ label: '一步' }] }],
    ['blank id', { nodes: [{ id: '  ', label: '一步' }] }],
    ['duplicate id', { nodes: [{ id: 'a', label: 'A' }, { id: 'a', label: 'B' }] }],
    ['missing label', { nodes: [{ id: 'a' }] }],
    ['blank label', { nodes: [{ id: 'a', label: '   ' }] }],
    ['over-long label', { nodes: [{ id: 'a', label: 'x'.repeat(MAX_FLOWCHART_LABEL_LENGTH + 1) }] }],
    ['unknown shape', { nodes: [{ id: 'a', label: 'A', shape: 'cloud' }] }],
    ['edges not an array', { nodes: [{ id: 'a', label: 'A' }], edges: {} }],
    [
      'too many connections',
      {
        nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
        edges: Array.from({ length: MAX_FLOWCHART_EDGES + 1 }, () => ({ from: 'a', to: 'b' })),
      },
    ],
    ['connection not an object', { nodes: [{ id: 'a', label: 'A' }], edges: ['a'] }],
    ['numeric endpoints', { nodes: [{ id: 'a', label: 'A' }], edges: [{ from: 1, to: 'a' }] }],
    ['undeclared target', { nodes: [{ id: 'a', label: 'A' }], edges: [{ from: 'a', to: 'ghost' }] }],
    ['self connection', { nodes: [{ id: 'a', label: 'A' }], edges: [{ from: 'a', to: 'a' }] }],
    ['numeric connection label', { nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], edges: [{ from: 'a', to: 'b', label: 7 }] }],
  ])('refuses %s', (_label, payload) => {
    expect(parseFlowchartPayload(payload)).toBeNull()
  })

  it('is refused by validateCardArgs with the payload reason', () => {
    const result = validateCardArgs({ kind: 'flowchart', payload: { nodes: [{ id: 'a', label: 'A' }], edges: [{ from: 'a', to: 'b' }] } })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('not declared')
  })

  it('admits a well-formed diagram', () => {
    const result = validateCardArgs({ kind: 'flowchart', title: 'if~else', payload: ifElse })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.card.kind).toBe('flowchart')
  })

  it('summarizes the diagram in prose', () => {
    const card = parseCardSpec({ kind: 'flowchart', title: 'if~else', payload: ifElse })
    expect(card).not.toBeNull()
    if (card === null) return
    expect(summarizeCard(card)).toBe('Showed a "flowchart" card titled "if~else": 4 node(s), 3 connection(s).')
  })

  it('falls back to payload keys when a flowchart payload is unusable', () => {
    const card = parseCardSpec({ kind: 'flowchart', payload: { nodes: [] } })
    expect(card).not.toBeNull()
    if (card === null) return
    expect(summarizeCard(card)).toBe('Showed a "flowchart" card (payload keys: nodes).')
  })
})

describe('validateCardArgs', () => {
  it('admits a well-formed table', () => {
    const result = validateCardArgs(table({ columns: ['月份', '收入'], rows: [['1月', 120]] }, '月度收入'))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.card.kind).toBe('table')
  })

  it('admits an unknown kind without inspecting its payload', () => {
    expect(validateCardArgs({ kind: 'school.timetable', payload: { slots: [{ a: 1 }] } }).ok).toBe(true)
  })

  it('survives the persistence round trip the browser replays', () => {
    const args = { kind: 'table', title: '月度收入', payload: { columns: ['月份'], rows: [['1月']] } }
    const admitted = validateCardArgs(args)
    expect(admitted.ok).toBe(true)
    if (!admitted.ok) return
    const persisted = JSON.parse(JSON.stringify(admitted.card)) as unknown
    expect(parseCardSpec(persisted)).toEqual(admitted.card)
  })
})

describe('parseCardSpec', () => {
  it('returns null for anything unusable instead of throwing', () => {
    for (const value of [undefined, null, 0, 'card', [], { kind: 'note' }]) {
      expect(parseCardSpec(value)).toBeNull()
    }
  })
})

describe('summarizeCard', () => {
  it('reports a table payload shape in prose', () => {
    const card = parseCardSpec(table({ columns: ['月份', '收入'], rows: [['1月', 120], ['2月', 130]] }, '月度收入'))
    expect(card).not.toBeNull()
    if (card === null) return
    const summary = summarizeCard(card)
    expect(summary).toBe('Showed a "table" card titled "月度收入": columns 月份, 收入; 2 row(s).')
  })

  it('falls back to payload keys for an unknown kind', () => {
    const card = parseCardSpec({ kind: 'gantt', payload: { tasks: [], milestones: [] } })
    expect(card).not.toBeNull()
    if (card === null) return
    expect(summarizeCard(card)).toBe('Showed a "gantt" card (payload keys: tasks, milestones).')
  })

  it('says so when a table-shaped payload is unusable', () => {
    const card = parseCardSpec(table({ columns: ['a'], rows: [[1, 2]] }))
    expect(card).not.toBeNull()
    if (card === null) return
    expect(summarizeCard(card)).toBe('Showed a "table" card (payload keys: columns, rows).')
  })
})