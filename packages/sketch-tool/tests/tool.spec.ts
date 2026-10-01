/**
 * `sketch_function` tool tests.
 *
 * These run the tool through the real registry rather than calling `execute`
 * directly, so schema validation, output snapshotting, and the render path are
 * all exercised the way a live model call would exercise them.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolExecutionInput } from '@deepseek-ai/dsh-tools'
import * as sketchTool from '../src/index.ts'

const signal = new AbortController().signal

async function setup(): Promise<Context> {
  const ctx = new Context()
  // Mount the two services the plugin injects, then load the plugin through
  // its real module shape so `inject` gates activation as it would in a Host.
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(sketchTool)
  return ctx
}

function call(name: string, args: unknown): ToolExecutionInput {
  return { signal, callId: ToolCallId('c1'), name, arguments: args }
}

/** The rendered text a model would read back. */
function textOf(content: readonly { type: string; text?: string }[]): string {
  return content.map((b) => b.text ?? '').join('')
}

let ctx: Context
beforeEach(async () => {
  ctx = await setup()
})

describe('registration', () => {
  it('registers one model-visible tool named sketch_function', () => {
    const names = ctx.tools.schemas().map((s) => s.name)
    expect(names).toContain('sketch_function')
  })

  it('states the no-HTML rule in the system prompt', async () => {
    const prompt = renderPrompt(await ctx.systemPrompt.assemble({}))
    expect(prompt).toContain('sketch_function')
    expect(prompt).toContain('do not write HTML')
  })
})

describe('drawing a curve', () => {
  it('returns the canonical spec and a factual summary', async () => {
    const result = await ctx.tools.execute(call('sketch_function', { expr: 'x^2' }))
    expect(result.isError).toBeFalsy()
    expect(result.value).toMatchObject({ spec: { expr: 'x^2' } })
    expect(textOf(result.content)).toContain('Drew x^2')
  })

  it('omits the mode key for a plain curve, keeping the spec minimal', async () => {
    const result = await ctx.tools.execute(call('sketch_function', { expr: 'x^2' }))
    expect(result.value).not.toHaveProperty('spec.mode')
  })

  it('keeps a non-default mode in the spec', async () => {
    const result = await ctx.tools.execute(call('sketch_function', { expr: 'sin(x)', mode: 'tangent' }))
    expect(result.value).toMatchObject({ spec: { expr: 'sin(x)', mode: 'tangent' } })
  })

  it('reports the parameter values it drew with', async () => {
    const result = await ctx.tools.execute(call('sketch_function', {
      expr: 'A*sin(w*x)',
      params: { A: [0.2, 2, 1.5], w: [0.5, 4, 2] },
    }))
    const text = textOf(result.content)
    expect(text).toContain('A=1.5')
    expect(text).toContain('w=2')
  })
})

describe('parameter hygiene', () => {
  it('drops a parameter the expression never uses', async () => {
    const result = await ctx.tools.execute(call('sketch_function', {
      expr: 'sin(x)',
      params: { Z: [1, 5, 2] },
    }))
    expect(result.value).toMatchObject({ spec: { expr: 'sin(x)' } })
    expect(result.value).not.toHaveProperty('spec.params')
  })

  it('rejects a parameter whose bounds are inverted', async () => {
    const result = await ctx.tools.execute(call('sketch_function', {
      expr: 'A*x',
      params: { A: [5, 1, 2] },
    }))
    expect(result.isError).toBe(true)
    expect(textOf(result.content)).toContain('must exceed min')
  })

  it('rejects a parameter value outside its own bounds', async () => {
    const result = await ctx.tools.execute(call('sketch_function', {
      expr: 'A*x',
      params: { A: [0, 1, 9] },
    }))
    expect(result.isError).toBe(true)
    expect(textOf(result.content)).toContain('outside')
  })
})

describe('modes', () => {
  it('reports the slope for a tangent', async () => {
    const result = await ctx.tools.execute(call('sketch_function', {
      expr: 'cos(x)',
      mode: 'tangent',
      probe: 0,
    }))
    const text = textOf(result.content)
    expect(text).toContain('slope')
    // cos'(0) = -sin(0) = 0. The finite-difference weights leave a residual
    // near 1e-15 rather than an exact zero, so parse the printed value and
    // assert the magnitude instead of the literal text. The trailing `\.?`
    // keeps the greedy character class from swallowing the sentence period.
    const slope = Number(/slope f'\(x\)=(-?[\d.]+(?:e-?\d+)?)\./.exec(text)?.[1])
    expect(Number.isFinite(slope)).toBe(true)
    expect(Math.abs(slope)).toBeLessThan(1e-6)
  })

  it('reports a non-trivial slope, proving the derivative is not a zero stub', async () => {
    // cos'(pi/2) = -sin(pi/2) = -1. A stub returning 0 would pass the test
    // above, so this control is what makes that assertion meaningful.
    const result = await ctx.tools.execute(call('sketch_function', {
      expr: 'cos(x)',
      mode: 'tangent',
      probe: Math.PI / 2,
    }))
    const slope = Number(/slope f'\(x\)=(-?[\d.]+(?:e-?\d+)?)\./.exec(textOf(result.content))?.[1])
    expect(slope).toBeCloseTo(-1, 3)
  })

  it('reports both the sum and the exact integral for an area', async () => {
    const result = await ctx.tools.execute(call('sketch_function', {
      expr: 'sin(x)',
      mode: 'riemann',
      a: 0,
      b: Math.PI,
      n: 15,
    }))
    const text = textOf(result.content)
    expect(text).toContain('Riemann sum')
    expect(text).toContain('exact integral')
    expect(text).toContain('n=15')
  })

  it('lists the Taylor coefficients it expanded with', async () => {
    const result = await ctx.tools.execute(call('sketch_function', {
      expr: 'sin(x)',
      mode: 'taylor',
      center: 0,
      order: 5,
    }))
    const text = textOf(result.content)
    expect(text).toContain('Taylor at a=0, degree 5')
    // 1/120 = 0.008333 -> rounds to 0.0083 below the display threshold.
    expect(text).toContain('1(x-a)')
  })

  it('accepts comparison curves with labels', async () => {
    const result = await ctx.tools.execute(call('sketch_function', {
      expr: 'x^2',
      mode: 'compare',
      curves: ['抛物线, x^2', '直线, 2x'],
    }))
    expect(result.value).toMatchObject({
      spec: { expr: 'x^2', mode: 'compare', compare: ['抛物线, x^2', '直线, 2x'] },
    })
    expect(textOf(result.content)).toContain('抛物线, 直线')
  })

  it('draws a named dataset in data mode', async () => {
    const result = await ctx.tools.execute(call('sketch_function', {
      expr: 'chart',
      mode: 'data',
      dataset: 'bar',
    }))
    expect(textOf(result.content)).toContain('data chart')
  })
})

describe('argument validation', () => {
  it('rejects an empty expression', async () => {
    const result = await ctx.tools.execute(call('sketch_function', { expr: '   ' }))
    expect(result.isError).toBe(true)
    expect(textOf(result.content)).toContain('non-empty')
  })

  it('rejects an inverted x-window', async () => {
    const result = await ctx.tools.execute(call('sketch_function', {
      expr: 'x',
      x_min: 5,
      x_max: 1,
    }))
    expect(result.isError).toBe(true)
    expect(textOf(result.content)).toContain('must be greater than')
  })

  it('rejects an out-of-range taylor order', async () => {
    const result = await ctx.tools.execute(call('sketch_function', {
      expr: 'sin(x)',
      mode: 'taylor',
      order: 99,
    }))
    expect(result.isError).toBe(true)
    expect(textOf(result.content)).toContain('invalid order')
  })

  it('rejects an out-of-range rectangle count', async () => {
    const result = await ctx.tools.execute(call('sketch_function', {
      expr: 'sin(x)',
      mode: 'riemann',
      n: 5000,
    }))
    expect(result.isError).toBe(true)
    expect(textOf(result.content)).toContain('invalid n')
  })

  it('rejects too many comparison curves', async () => {
    const result = await ctx.tools.execute(call('sketch_function', {
      expr: 'x',
      mode: 'compare',
      curves: Array.from({ length: 8 }, (_, i) => `x+${i}`),
    }))
    expect(result.isError).toBe(true)
    expect(textOf(result.content)).toContain('at most')
  })

  it('surfaces a syntax error with its offset so the model can fix it', async () => {
    const result = await ctx.tools.execute(call('sketch_function', { expr: 'sin(' }))
    expect(result.isError).toBe(true)
    expect(textOf(result.content)).toContain('cannot parse expression')
    expect(textOf(result.content)).toContain('offset')
  })

  it('rejects an unknown function by name', async () => {
    const result = await ctx.tools.execute(call('sketch_function', { expr: 'foo(x)' }))
    expect(result.isError).toBe(true)
    expect(textOf(result.content)).toContain('foo')
  })
})

describe('result shape', () => {
  it('snapshots a lossless JSON value', async () => {
    const result = await ctx.tools.execute(call('sketch_function', {
      expr: 'A*x^2',
      params: { A: [1, 3, 2] },
    }))
    // A round trip through JSON must be a no-op: the card replays this value.
    expect(JSON.parse(JSON.stringify(result.value))).toEqual(result.value)
  })

  it('persists the spec in presentation metadata for replay', async () => {
    const result = await ctx.tools.execute(call('sketch_function', { expr: 'x^3' }))
    expect(result.meta).toMatchObject({ spec: { expr: 'x^3' } })
  })
})
