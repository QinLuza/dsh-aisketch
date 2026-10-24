/**
 * `show_card` tool tests.
 *
 * The behavior tests run the tool through the real registry, so schema
 * validation, execution, result rendering, and the prompt section are exercised
 * the way a live model call exercises them. The contract tests read the
 * registered definition directly, because `presentationMeta` is what the
 * browser projection depends on and no model-visible surface exposes it.
 *
 * Note the presenter wrapper `defineTool` installs: it validates arguments
 * first and returns `undefined` for a call the schema refuses, so a presenter
 * test must pass admissible arguments and assert that behavior separately.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolExecutionInput } from '@deepseek-ai/dsh-tools'
import * as cardsTool from '../src/index.ts'

const signal = new AbortController().signal

/** One admissible call, reused wherever a presenter needs valid arguments. */
const validArgs = { kind: 'table', title: '月度收入', payload: { columns: ['月份'], rows: [['1月']] } }

/** The slice of a registered Tool definition this suite pins. */
interface CapturedTool {
  readonly name: string
  readonly presentCall: (args: unknown) => { readonly card?: unknown; readonly title?: unknown; readonly kind?: unknown } | undefined
  readonly presentResult: (
    args: unknown,
    result: { content: readonly { type: string; text?: string }[] },
  ) => unknown
  readonly output: {
    readonly presentationMeta: (args: unknown, value: { card: unknown; summary: string }) => Record<string, unknown>
  }
}

function call(name: string, args: unknown): ToolExecutionInput {
  return { signal, callId: ToolCallId('c1'), name, arguments: args }
}

/** The rendered text a model would read back. */
function textOf(content: readonly { type: string; text?: string }[]): string {
  return content.map((block) => block.text ?? '').join('')
}

/** Register the plugin against a recording stand-in for the two injected services. */
function capture(): CapturedTool[] {
  const captured: CapturedTool[] = []
  const ctx = {
    tools: { register: (definition: unknown) => { captured.push(definition as CapturedTool) } },
    systemPrompt: { section: () => {}, getSectionOrder: () => 0 },
  } as unknown as Context
  cardsTool.apply(ctx)
  return captured
}

let ctx: Context
beforeEach(async () => {
  ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(cardsTool)
})

describe('registration', () => {
  it('registers one model-visible tool named show_card', () => {
    expect(ctx.tools.schemas().map((schema) => schema.name)).toContain('show_card')
  })

  it('states the no-markup rule in the system prompt', async () => {
    const prompt = renderPrompt(await ctx.systemPrompt.assemble({}))
    expect(prompt).toContain('show_card')
    expect(prompt).toContain('never write HTML')
    expect(prompt).toContain('illustration')
    expect(prompt).toContain('figure')
    expect(prompt).toContain('draft:true')
    expect(prompt).not.toContain('add 1-3 short labels')
  })
})

describe('showing a table card', () => {
  it('returns the admitted spec and a factual summary', async () => {
    const result = await ctx.tools.execute(call('show_card', {
      kind: 'table',
      title: '月度收入',
      payload: { columns: ['月份', '收入'], rows: [['1月', 120], ['2月', 130]] },
    }))
    expect(result.isError).toBeFalsy()
    expect(result.value).toMatchObject({ card: { kind: 'table', title: '月度收入' } })
    expect(textOf(result.content)).toBe('Showed a "table" card titled "月度收入": columns 月份, 收入; 2 row(s).')
  })

  it('stamps the contract version so a renderer can tell specs apart', async () => {
    const result = await ctx.tools.execute(call('show_card', { kind: 'note', payload: {} }))
    expect(result.value).toMatchObject({ card: { version: 1 } })
  })

  it('keeps an unknown kind verbatim, so a newer renderer can still claim it', async () => {
    const result = await ctx.tools.execute(call('show_card', {
      kind: 'school.timetable',
      payload: { slots: [{ day: 1, subject: '数学' }] },
    }))
    expect(result.isError).toBeFalsy()
    expect(result.value).toMatchObject({ card: { kind: 'school.timetable' } })
    expect(textOf(result.content)).toContain('school.timetable')
  })

  it('omits a blank title instead of storing an empty one', async () => {
    const result = await ctx.tools.execute(call('show_card', { kind: 'note', title: '   ', payload: {} }))
    expect(result.value).not.toHaveProperty('card.title')
  })

  it('refuses a row wider than its header, so the model can correct it', async () => {
    const result = await ctx.tools.execute(call('show_card', {
      kind: 'table',
      payload: { columns: ['a'], rows: [['x', 'y']] },
    }))
    expect(result.isError).toBe(true)
    expect(textOf(result.content)).toContain('one per column')
  })

  it('refuses a kind that is not an identifier', async () => {
    const result = await ctx.tools.execute(call('show_card', { kind: '../escape', payload: {} }))
    expect(result.isError).toBe(true)
  })
})

describe('showing a flowchart card', () => {
  /** One admissible if/else diagram. */
  const ifElse = {
    nodes: [
      { id: 'start', label: '开始', shape: 'terminal' },
      { id: 'check', label: '条件成立？', shape: 'decision' },
      { id: 'yes', label: '执行 A' },
      { id: 'no', label: '执行 B' },
    ],
    edges: [
      { from: 'start', to: 'check' },
      { from: 'check', to: 'yes', label: '是' },
      { from: 'check', to: 'no', label: '否' },
    ],
  }

  it('returns the admitted diagram and a factual summary', async () => {
    const result = await ctx.tools.execute(call('show_card', { kind: 'flowchart', title: 'if~else', payload: ifElse }))
    expect(result.isError).toBeFalsy()
    expect(result.value).toMatchObject({ card: { kind: 'flowchart', title: 'if~else' } })
    expect(textOf(result.content)).toBe('Showed a "flowchart" card titled "if~else": 4 node(s), 3 connection(s).')
  })

  it('refuses a connection to a node that was never declared, so the model can correct it', async () => {
    const result = await ctx.tools.execute(call('show_card', {
      kind: 'flowchart',
      payload: { nodes: [{ id: 'a', label: 'A' }], edges: [{ from: 'a', to: 'ghost' }] },
    }))
    expect(result.isError).toBe(true)
    expect(textOf(result.content)).toContain('not declared')
  })

  it('tells the model where the geometry comes from', () => {
    const schemas = ctx.tools.schemas()
    const schema = schemas.find((candidate) => candidate.name === 'show_card')
    expect(JSON.stringify(schema)).toContain('flowchart')
    expect(JSON.stringify(schema)).toContain('Never send coordinates or SVG')
  })
})

describe('drawing a finished picture', () => {
  /** A small organic scene: no title, labels or tape, but real path washes. */
  const sketch = {
    kind: 'draw',
    title: '山坡',
    payload: {
      size: { w: 1200, h: 800 },
      paper: 'plain',
      elements: [
        {
          type: 'path',
          pen: 'fountain',
          color: '#4c6b3c',
          fill: '#9bb47a',
          fillOpacity: 0.35,
          d: 'M 100 620 C 260 520 360 600 520 540 C 620 500 720 560 820 520 L 820 720 L 100 720 Z',
        },
        { type: 'path', pen: 'pencil', color: '#5b7248', d: 'M 120 660 C 300 620 500 650 760 620' },
      ],
    },
  }

  it('returns a structural self-check without prescribing field-note labels', async () => {
    const result = await ctx.tools.execute(call('show_card', sketch))
    expect(result.isError).toBeFalsy()
    expect(result.value).toMatchObject({ card: { kind: 'draw', title: '山坡' } })
    const check = String((result.value as { selfCheck?: unknown }).selfCheck ?? '')
    expect(check).toContain('<self-check>')
    expect(check).not.toContain('add 1-3 short labels')
    expect(check).not.toContain('field-notebook')
  })

  it('marks a draft as private in the self-check', async () => {
    const result = await ctx.tools.execute(call('show_card', { ...sketch, draft: true }))
    expect(result.isError).toBeFalsy()
    expect(result.value).toMatchObject({ card: { kind: 'draw' } })
    expect(String((result.value as { selfCheck?: unknown }).selfCheck ?? '')).toContain('private draft')
  })

  it('exposes the one-shot delivery switch to the model', () => {
    const schema = ctx.tools.schemas().find(candidate => candidate.name === 'show_card')
    expect(JSON.stringify(schema)).toContain('draft')
    expect(JSON.stringify(schema)).toContain('no card is shown to the user')
  })
})

describe('showing a teaching figure', () => {
  it('admits an incline figure and summarizes its semantics', async () => {
    const result = await ctx.tools.execute(call('show_card', {
      kind: 'figure',
      title: '斜面受力',
      payload: { template: 'incline_force', params: { angleDeg: 30, massKg: 2, frictionCoeff: 0.5 } },
    }))
    expect(result.isError).toBeFalsy()
    expect(result.value).toMatchObject({ card: { kind: 'figure', title: '斜面受力' } })
    expect(textOf(result.content)).toContain('incline_force')
    expect(textOf(result.content)).toContain('θ=30°')
    expect(textOf(result.content)).toContain('m=2 kg')
  })

  it('admits a connected table-pulley figure with semantic forces', async () => {
    const result = await ctx.tools.execute(call('show_card', {
      kind: 'figure',
      payload: { template: 'connected_bodies', params: { surfaceMassKg: 2, hangingMassKg: 1.5, frictionCoeff: 0.3 } },
    }))
    expect(result.isError).toBeFalsy()
    expect(result.value).toMatchObject({ card: { kind: 'figure' } })
    expect(textOf(result.content)).toContain('connected_bodies')
    expect(textOf(result.content)).toContain('m₁=2 kg')
  })

  it('admits an orbital diagram whose configuration is derived from the element', async () => {
    const result = await ctx.tools.execute(call('show_card', {
      kind: 'figure',
      payload: { template: 'orbital_diagram', params: { symbol: 'Zn' } },
    }))
    expect(result.isError).toBeFalsy()
    expect(result.value).toMatchObject({ card: { kind: 'figure' } })
    expect(textOf(result.content)).toContain('orbital_diagram: Zn (Z=30)')
  })

  it('admits an atom figure whose electrons are derived from the element', async () => {
    const result = await ctx.tools.execute(call('show_card', {
      kind: 'figure',
      payload: { template: 'atom_shell', params: { symbol: 'Na' } },
    }))
    expect(result.isError).toBeFalsy()
    expect(result.value).toMatchObject({ card: { kind: 'figure' } })
    expect(textOf(result.content)).toContain('Na, Z=11, shells 2,8,1')
  })

  it('refuses a physically unreadable angle so the model can correct it', async () => {
    const result = await ctx.tools.execute(call('show_card', {
      kind: 'figure',
      payload: { template: 'incline_force', params: { angleDeg: 90, massKg: 2, frictionCoeff: 0.5 } },
    }))
    expect(result.isError).toBe(true)
    expect(textOf(result.content)).toContain('angleDeg')
  })

  it('exposes both templates and the draw/figure routing rule', () => {
    const schema = ctx.tools.schemas().find(candidate => candidate.name === 'show_card')
    const serialized = JSON.stringify(schema)
    expect(serialized).toContain('incline_force')
    expect(serialized).toContain('connected_bodies')
    expect(serialized).toContain('orbital_diagram')
    expect(serialized).toContain('atom_shell')
    expect(serialized).toContain('never for freehand')
    expect(serialized).toContain('figure')
  })
})

describe('the browser contract', () => {
  it('publishes the admitted spec as presentation metadata', () => {
    const [definition] = capture()
    expect(definition?.name).toBe('show_card')
    const card = { version: 1, kind: 'table', payload: { columns: ['a'], rows: [] } }
    expect(definition?.output.presentationMeta(validArgs, { card, summary: 'x' })).toEqual({ card })
  })

  it('titles the pending row with the kind being drawn', () => {
    const [definition] = capture()
    expect(definition?.presentCall(validArgs)).toMatchObject({ card: 'generic', title: 'table', kind: 'read' })
  })

  it('echoes the summary as the settled tool text', () => {
    const [definition] = capture()
    expect(definition?.presentResult(validArgs, { content: [{ type: 'text', text: 'summary' }] }))
      .toEqual({ card: 'generic', content: [{ type: 'text', text: 'summary' }] })
    expect(definition?.presentResult(validArgs, { content: [] })).toBeUndefined()
  })

  it('presents nothing at all for arguments the schema refuses', () => {
    const [definition] = capture()
    expect(definition?.presentCall({})).toBeUndefined()
    expect(definition?.presentResult({}, { content: [{ type: 'text', text: 'x' }] })).toBeUndefined()
  })
})