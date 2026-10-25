import { describe, expect, it } from 'vitest'
import {
  CARD_SPEC_VERSION, MAX_DRAW_ELEMENTS, MAX_DRAW_TEXT_LENGTH, MAX_FLOWCHART_EDGES, MAX_FLOWCHART_LABEL_LENGTH,
  MAX_FLOWCHART_NODES, MAX_KIND_LENGTH, MAX_PAYLOAD_LENGTH, MAX_TABLE_COLUMNS, MAX_TABLE_ROWS,
  parseCardSpec, parseDrawPathData, parseDrawPayload, parseFlowchartPayload, parseTablePayload,
  readCardEnvelope, summarizeCard, validateCardArgs,
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

describe('draw payload', () => {
  /** One admissible sketch, reused by the cases below. */
  const sketch = {
    paper: 'grid',
    elements: [
      { type: 'path', d: 'M 40 200 L 200 200 L 200 80 Z', pen: 'fountain', color: 'blue' },
      { type: 'shape', shape: 'rect', x: 240, y: 100, w: 120, h: 80, fill: 'yellow', dash: 'dashed' },
      { type: 'text', x: 300, y: 160, text: '房间', hand: true, anchor: 'middle' },
      { type: 'tape', x: 400, y: 60, w: 90 },
    ],
  }

  it('applies defaults: 640x400 plain paper, rough on, ball pen at width 2', () => {
    const parsed = parseDrawPayload({ elements: [{ type: 'path', d: 'M 10 10 L 100 100' }] })
    expect(parsed).not.toBeNull()
    if (parsed === null) return
    expect(parsed.size).toEqual({ w: 640, h: 400 })
    expect(parsed.paper).toBe('plain')
    expect(parsed.background).toBeUndefined()
    expect(parsed.rough).toBe(true)
    expect(parsed.elements[0]).toMatchObject({ type: 'path', pen: 'ball', width: 2, color: undefined, dash: 'solid' })
    expect('strokeOpacity' in (parsed.elements[0] ?? {})).toBe(false)
  })

  it('keeps a canvas background by name or hex, and treats "none" as no background', () => {
    const named = parseDrawPayload({ background: 'blue', elements: [{ type: 'path', d: 'M 0 0 L 10 10' }] })
    expect(named?.background).toBe('blue')
    const hex = parseDrawPayload({ background: '#102030', elements: [{ type: 'path', d: 'M 0 0 L 10 10' }] })
    expect(hex?.background).toBe('#102030')
    const none = parseDrawPayload({ background: 'none', elements: [{ type: 'path', d: 'M 0 0 L 10 10' }] })
    expect(none?.background).toBeUndefined()
  })

  it('accepts a gradient fill as from/to shorthand, and defaults the angle to top-down', () => {
    const parsed = parseDrawPayload({
      elements: [{
        type: 'shape', shape: 'rect', x: 0, y: 0, w: 10, h: 10,
        fill: { type: 'linear', from: 'blue', to: '#102030' },
      }],
    })
    const fill = (parsed?.elements[0] as { fill?: unknown } | undefined)?.fill
    expect(fill).toEqual({
      type: 'linear',
      angle: 180,
      center: undefined,
      radius: undefined,
      stops: [
        { offset: 0, color: 'blue', opacity: 1 },
        { offset: 1, color: '#102030', opacity: 1 },
      ],
    })
  })

  it('sorts gradient stops by offset and keeps per-stop opacity', () => {
    const parsed = parseDrawPayload({
      elements: [{
        type: 'path', d: 'M 0 0 L 10 0 L 10 10 Z', fill: {
          type: 'radial',
          stops: [{ offset: 1, color: 'red' }, { offset: 0, color: 'blue', opacity: 0.2 }],
          center: { x: 5, y: 5 },
          radius: 20,
        },
      }],
    })
    const fill = (parsed?.elements[0] as { fill?: unknown } | undefined)?.fill
    expect(fill).toMatchObject({
      type: 'radial',
      center: { x: 5, y: 5 },
      radius: 20,
      stops: [{ offset: 0, color: 'blue', opacity: 0.2 }, { offset: 1, color: 'red', opacity: 1 }],
    })
  })

  it('refuses a CSS gradient string with the JSON form that would work', () => {
    const result = validateCardArgs({
      kind: 'draw',
      payload: { elements: [{ type: 'shape', shape: 'rect', x: 0, y: 0, w: 10, h: 10, fill: 'linear-gradient(#fff, #000)' }] },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('cannot be a CSS string')
      expect(result.error).toContain('"type":"linear","from"')
    }
  })

  it.each([
    ['gradient with one stop', { type: 'linear', stops: [{ offset: 0, color: 'blue' }] }],
    ['gradient with too many stops', { type: 'linear', stops: Array.from({ length: 9 }, (_v, index) => ({ offset: index / 8, color: 'blue' })) }],
    ['gradient offset out of range', { type: 'linear', stops: [{ offset: -1, color: 'blue' }, { offset: 1, color: 'red' }] }],
    ['a stop without a color', { type: 'linear', stops: [{ offset: 0 }, { offset: 1, color: 'red' }] }],
    ['a stop opacity out of range', { type: 'linear', stops: [{ offset: 0, color: 'blue', opacity: 2 }, { offset: 1, color: 'red' }] }],
    ['from without to', { type: 'linear', from: 'blue' }],
    ['both stops and from/to', { type: 'linear', from: 'blue', to: 'red', stops: [{ offset: 0, color: 'blue' }, { offset: 1, color: 'red' }] }],
    ['an unknown gradient type', { type: 'conic', from: 'blue', to: 'red' }],
    ['a linear gradient with a center', { type: 'linear', from: 'blue', to: 'red', center: { x: 1, y: 2 } }],
    ['a radial gradient with an angle', { type: 'radial', from: 'blue', to: 'red', angle: 45 }],
    ['a radial gradient with a negative radius', { type: 'radial', from: 'blue', to: 'red', radius: -5 }],
  ])('refuses a gradient with %s', (_label, fill) => {
    expect(parseDrawPayload({ elements: [{ type: 'shape', shape: 'rect', x: 0, y: 0, w: 10, h: 10, fill }] })).toBeNull()
  })

  it('keeps a faded stroke and a faded outline, down to fully transparent ink', () => {
    const parsed = parseDrawPayload({
      elements: [
        { type: 'path', d: 'M 0 0 L 40 0', pen: 'ball', dash: 'dotted', strokeOpacity: 0.35 },
        { type: 'shape', shape: 'line', x: 0, y: 10, w: 40, h: 0, strokeOpacity: 0 },
      ],
    })
    expect(parsed).not.toBeNull()
    if (parsed === null) return
    expect(parsed.elements[0]).toMatchObject({ type: 'path', dash: 'dotted', strokeOpacity: 0.35 })
    expect(parsed.elements[1]).toMatchObject({ type: 'shape', strokeOpacity: 0 })
  })

  it('keeps explicit canvas, paper and element fields', () => {
    const parsed = parseDrawPayload({ ...sketch, size: { w: 800, h: 300 }, rough: false })
    expect(parsed).not.toBeNull()
    if (parsed === null) return
    expect(parsed.size).toEqual({ w: 800, h: 300 })
    expect(parsed.rough).toBe(false)
    expect(parsed.elements[1]).toMatchObject({
      type: 'shape', shape: 'rect', x: 240, y: 100, w: 120, h: 80,
      fill: 'yellow', dash: 'dashed', rough: false,
    })
    expect(parsed.elements[2]).toMatchObject({ type: 'text', text: '房间', hand: true, anchor: 'middle' })
    expect(parsed.elements[3]).toMatchObject({ type: 'tape', w: 90, h: 26, angle: -6 })
  })

  it('normalizes a fill of "none" to no fill', () => {
    const parsed = parseDrawPayload({ elements: [{ type: 'shape', shape: 'rect', x: 0, y: 0, w: 10, h: 10, fill: 'none' }] })
    expect(parsed?.elements[0]).toMatchObject({ type: 'shape', fill: undefined })
  })

  it('accepts a translucent fill on an organic path, so a wash need not be a primitive', () => {
    const parsed = parseDrawPayload({
      elements: [{ type: 'path', d: 'M 0 40 C 20 0 60 0 80 40 Z', fill: 'blue', fillOpacity: 0.35 }],
    })
    expect(parsed?.elements[0]).toMatchObject({ type: 'path', fill: 'blue', fillOpacity: 0.35 })
  })

  it.each([
    ['no elements', {}],
    ['empty elements', { elements: [] }],
    ['too many elements', { elements: Array.from({ length: MAX_DRAW_ELEMENTS + 1 }, () => ({ type: 'text', x: 0, y: 0, text: 'x' })) }],
    ['unknown element type', { elements: [{ type: 'image', src: 'x' }] }],
    ['size not an object', { size: [], elements: [{ type: 'text', x: 0, y: 0, text: 'x' }] }],
    ['size out of range', { size: { w: 5000 }, elements: [{ type: 'text', x: 0, y: 0, text: 'x' }] }],
    ['unknown paper', { paper: 'carbon', elements: [{ type: 'text', x: 0, y: 0, text: 'x' }] }],
    ['unknown background color', { background: 'chartreuse', elements: [{ type: 'text', x: 0, y: 0, text: 'x' }] }],
    ['non-string background', { background: 7, elements: [{ type: 'text', x: 0, y: 0, text: 'x' }] }],
    ['non-boolean rough', { rough: 'yes', elements: [{ type: 'text', x: 0, y: 0, text: 'x' }] }],
    ['blank path', { elements: [{ type: 'path', d: '   ' }] }],
    ['unknown pen', { elements: [{ type: 'path', d: 'M 0 0 L 10 10', pen: 'quill' }] }],
    ['width out of range', { elements: [{ type: 'path', d: 'M 0 0 L 10 10', width: 40 }] }],
    ['unknown color', { elements: [{ type: 'path', d: 'M 0 0 L 10 10', color: 'chartreuse' }] }],
    ['bad hex color', { elements: [{ type: 'path', d: 'M 0 0 L 10 10', color: '#12g456' }] }],
    ['path fillOpacity out of range', { elements: [{ type: 'path', d: 'M 0 0 L 10 10', fill: 'blue', fillOpacity: 2 }] }],
    ['path strokeOpacity out of range', { elements: [{ type: 'path', d: 'M 0 0 L 10 10', strokeOpacity: 1.5 }] }],
    ['unknown path dash', { elements: [{ type: 'path', d: 'M 0 0 L 10 10', dash: 'wavy' }] }],
    [
      'dash on a pen that draws an outline',
      { elements: [{ type: 'path', d: 'M 0 0 L 10 10', pen: 'fountain', dash: 'dashed' }] },
    ],
    ['shape strokeOpacity not a number', { elements: [{ type: 'shape', shape: 'rect', x: 0, y: 0, w: 10, h: 10, strokeOpacity: 'faint' }] }],
    ['unknown shape', { elements: [{ type: 'shape', shape: 'star', x: 0, y: 0, w: 10, h: 10 }] }],
    ['negative rect extent', { elements: [{ type: 'shape', shape: 'rect', x: 0, y: 0, w: -10, h: 10 }] }],
    ['zero-length line', { elements: [{ type: 'shape', shape: 'line', x: 0, y: 0, w: 0, h: 0 }] }],
    ['non-finite coordinate', { elements: [{ type: 'shape', shape: 'rect', x: Number.NaN, y: 0, w: 10, h: 10 }] }],
    ['unknown dash', { elements: [{ type: 'shape', shape: 'rect', x: 0, y: 0, w: 10, h: 10, dash: 'wavy' }] }],
    ['blank text', { elements: [{ type: 'text', x: 0, y: 0, text: '  ' }] }],
    ['over-long text', { elements: [{ type: 'text', x: 0, y: 0, text: 'x'.repeat(MAX_DRAW_TEXT_LENGTH + 1) }] }],
    ['text size out of range', { elements: [{ type: 'text', x: 0, y: 0, text: 'x', size: 200 }] }],
    ['unknown anchor', { elements: [{ type: 'text', x: 0, y: 0, text: 'x', anchor: 'center' }] }],
    ['tape width out of range', { elements: [{ type: 'tape', x: 0, y: 0, w: 3 }] }],
    ['tape angle out of range', { elements: [{ type: 'tape', x: 0, y: 0, w: 90, angle: 90 }] }],
    ['pixels without rows', { elements: [{ type: 'pixels', x: 0, y: 0, rows: [], palette: { '#': 'red' } }] }],
    ['pixels without palette', { elements: [{ type: 'pixels', x: 0, y: 0, rows: ['#'] }] }],
    ['pixels with a blank row', { elements: [{ type: 'pixels', x: 0, y: 0, rows: ['#', ''], palette: { '#': 'red' } }] }],
    ['pixels with a multi-character key', { elements: [{ type: 'pixels', x: 0, y: 0, rows: ['#'], palette: { '##': 'red' } }] }],
    ['pixels with no matching character', { elements: [{ type: 'pixels', x: 0, y: 0, rows: ['abc'], palette: { '#': 'red' } }] }],
    ['pixels with an invalid palette color', { elements: [{ type: 'pixels', x: 0, y: 0, rows: ['#'], palette: { '#': 'chartreuse' } }] }],
    ['pixels with an empty palette color', { elements: [{ type: 'pixels', x: 0, y: 0, rows: ['#'], palette: { '#': '' } }] }],
    [
      'pixels above the cell ceiling',
      { elements: [{ type: 'pixels', x: 0, y: 0, cell: 2, rows: Array.from({ length: 100 }, () => '#'.repeat(120)), palette: { '#': 'red' } }] },
    ],
  ])('refuses %s', (_label, payload) => {
    expect(parseDrawPayload(payload)).toBeNull()
  })

  it('parses a pixel-art block with defaults and ragged rows', () => {
    const parsed = parseDrawPayload({
      elements: [{ type: 'pixels', x: 40, y: 60, rows: ['##', '#'], palette: { '#': 'blue', '.': '#ffcc00' } }],
    })
    expect(parsed).not.toBeNull()
    if (parsed === null) return
    expect(parsed.elements[0]).toMatchObject({
      type: 'pixels', x: 40, y: 60, cell: 12, rows: ['##', '#'], palette: { '#': 'blue', '.': '#ffcc00' },
    })
  })

  it('refuses a dash on an outline pen by naming the pens it does work on', () => {
    const result = validateCardArgs({
      kind: 'draw',
      payload: { elements: [{ type: 'path', d: 'M 0 0 L 10 10', pen: 'brush', dash: 'dashed' }] },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('element 0')
      expect(result.error).toContain('ball, marker, pencil, highlighter')
    }
  })

  it('is refused by validateCardArgs with the payload reason', () => {
    const result = validateCardArgs({ kind: 'draw', payload: { elements: [{ type: 'path', d: 'M 0 0 L 10' }] } })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('element 0')
      expect(result.error).toContain('pairs')
    }
  })

  it('admits a well-formed sketch', () => {
    const result = validateCardArgs({ kind: 'draw', title: '我的房间', payload: sketch })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.card.kind).toBe('draw')
  })

  it('summarizes the sketch in prose', () => {
    const card = parseCardSpec({ kind: 'draw', title: '我的房间', payload: sketch })
    expect(card).not.toBeNull()
    if (card === null) return
    expect(summarizeCard(card)).toBe('Showed a "draw" card titled "我的房间": 4 element(s) on 640x400 grid paper.')
  })

  it('falls back to payload keys when a draw payload is unusable', () => {
    const card = parseCardSpec({ kind: 'draw', payload: { elements: [] } })
    expect(card).not.toBeNull()
    if (card === null) return
    expect(summarizeCard(card)).toBe('Showed a "draw" card (payload keys: elements).')
  })
})

describe('draw path grammar', () => {
  it('expands implicit coordinate groups after M into linetos', () => {
    const parsed = parseDrawPathData('M 0 0 10 10 20 20')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.commands.map(command => command.cmd)).toEqual(['M', 'L', 'L'])
  })

  it('normalizes relative commands to absolute', () => {
    const parsed = parseDrawPathData('M 10 10 l 5 5 h 10 v 10')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.commands).toEqual([
      { cmd: 'M', x: 10, y: 10 },
      { cmd: 'L', x: 15, y: 15 },
      { cmd: 'L', x: 25, y: 15 },
      { cmd: 'L', x: 25, y: 25 },
    ])
  })

  it('elevates a quadratic to its exact cubic', () => {
    const parsed = parseDrawPathData('M 0 0 Q 10 20 20 0')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const cubic = parsed.commands[1]
    expect(cubic?.cmd).toBe('C')
    if (cubic?.cmd !== 'C') return
    expect(cubic.c1x).toBeCloseTo(20 / 3)
    expect(cubic.c1y).toBeCloseTo(40 / 3)
    expect(cubic.c2x).toBeCloseTo(40 / 3)
    expect(cubic.c2y).toBeCloseTo(40 / 3)
    expect(cubic.x).toBe(20)
    expect(cubic.y).toBe(0)
  })

  it('reads arc flags without separators, as the SVG grammar allows', () => {
    const parsed = parseDrawPathData('M 0 0 A 10 10 0 0110 10')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.commands[1]).toMatchObject({ cmd: 'A', rx: 10, ry: 10, rotation: 0, large: false, sweep: true, x: 10, y: 10 })
  })

  it.each([
    ['a command before M', 'L 10 10'],
    ['no drawing command', 'M 10 10'],
    ['an unknown command letter', 'M 0 0 X 5 5'],
    ['an exponent number', 'M 1e3 0'],
    ['odd coordinates', 'M 0 0 L 10'],
    ['an over-long arc', 'M 0 0 A 5 5 0 0 1 10'],
    ['arguments after Z', 'M 0 0 L 1 1 Z 5'],
  ])('refuses %s', (_label, d) => {
    expect(parseDrawPathData(d).ok).toBe(false)
  })
})
describe('blend modes', () => {
  it('defaults to normal and keeps a named mode on path, shape and pixels', () => {
    const parsed = parseDrawPayload({
      elements: [
        { type: 'path', d: 'M 0 0 L 10 0' },
        { type: 'shape', shape: 'rect', x: 0, y: 0, w: 10, h: 10, blend: 'screen' },
        { type: 'pixels', x: 0, y: 0, rows: ['#'], palette: { '#': 'red' }, blend: 'multiply' },
      ],
    })
    expect(parsed).not.toBeNull()
    if (parsed === null) return
    expect(parsed.elements[0]).toMatchObject({ type: 'path', blend: 'normal' })
    expect(parsed.elements[1]).toMatchObject({ type: 'shape', blend: 'screen' })
    expect(parsed.elements[2]).toMatchObject({ type: 'pixels', blend: 'multiply' })
  })

  it('refuses an unknown blend mode with the values it accepts', () => {
    const result = validateCardArgs({
      kind: 'draw',
      payload: { elements: [{ type: 'shape', shape: 'rect', x: 0, y: 0, w: 10, h: 10, blend: 'lighten' }] },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('normal, multiply, screen, overlay, soft-light')
  })
})

describe('blur', () => {
  it('keeps a positive blur on path and shape and drops a zero one', () => {
    const parsed = parseDrawPayload({
      elements: [
        { type: 'path', d: 'M 0 0 L 10 0', blur: 12 },
        { type: 'shape', shape: 'rect', x: 0, y: 0, w: 10, h: 10, blur: 0 },
      ],
    })
    expect(parsed).not.toBeNull()
    if (parsed === null) return
    expect(parsed.elements[0]).toMatchObject({ type: 'path', blur: 12 })
    expect('blur' in (parsed.elements[1] ?? {})).toBe(false)
  })

  it.each([
    ['a blur above the ceiling', 500],
    ['a negative blur', -2],
    ['a non-numeric blur', 'soft'],
  ])('refuses %s', (_label, blur) => {
    expect(parseDrawPayload({ elements: [{ type: 'shape', shape: 'rect', x: 0, y: 0, w: 10, h: 10, blur }] })).toBeNull()
  })
})
