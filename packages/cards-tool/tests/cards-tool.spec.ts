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