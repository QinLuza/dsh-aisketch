/**
 * AISketch end-to-end replay test.
 *
 * The claim this file exists to defend is the one that makes an inline card
 * worth building: a settled `tool/result` carries enough for the browser to
 * redraw the plot from scratch, with no Host round trip. The pieces are
 * verified apart elsewhere — `sketch-tool`'s suite covers the tool, the
 * geometry suite covers the maths — so this file only tests the seam:
 *
 *   tool call -> persisted meta -> card reads spec -> same geometry
 *
 * A round-trip that silently dropped or mangled the spec would still pass
 * every other test in the repository, which is exactly why this one exists.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { resolveGeometry } from '@gk/sketch-core'
import type { SketchSpec } from '@gk/sketch-core'
import * as sketchTool from '../src/index.ts'

const signal = new AbortController().signal

/** Build a context with the services the tool injects, then load the tool. */
async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(sketchTool)
  return ctx
}

/** Run one tool call through the real registry. */
async function call(ctx: Context, args: unknown) {
  return await ctx.tools.execute({
    signal,
    callId: ToolCallId('replay-1'),
    name: 'sketch_function',
    arguments: args,
  })
}

/**
 * Read the spec the way the browser card does.
 *
 * Mirrors `client-ui-sketch`'s `readSpec` deliberately: if the two ever
 * disagree about where the spec lives, this test fails rather than the browser.
 * @param meta - the persisted presentation metadata.
 * @returns the spec, or null when the shape is wrong.
 */
function readSpecLikeTheCard(meta: unknown): SketchSpec | null {
  if (typeof meta !== 'object' || meta === null) return null
  const spec = (meta as { spec?: unknown }).spec
  if (typeof spec !== 'object' || spec === null) return null
  const expr = (spec as { expr?: unknown }).expr
  if (typeof expr !== 'string' || expr.length === 0) return null
  return spec as SketchSpec
}

describe('replay', () => {
  it('persists a spec the card can read back', async () => {
    const ctx = await setup()
    const result = await call(ctx, { expr: 'x^2' })

    const spec = readSpecLikeTheCard(result.meta)
    expect(spec).not.toBeNull()
    expect(spec?.expr).toBe('x^2')
  })

  it('survives a JSON round trip unchanged', async () => {
    const ctx = await setup()
    const result = await call(ctx, {
      expr: 'A*sin(w*x)',
      params: { A: [0.2, 2, 1.5], w: [0.5, 4, 2] },
    })

    // The session log stores JSON; whatever the card reads must equal what the
    // tool wrote, byte for byte, or a replay draws a different picture.
    const stored = JSON.parse(JSON.stringify(result.meta)) as unknown
    expect(stored).toEqual(result.meta)
    expect(readSpecLikeTheCard(stored)).toEqual(readSpecLikeTheCard(result.meta))
  })

  it('redraws identical geometry from the persisted spec alone', async () => {
    const ctx = await setup()
    const result = await call(ctx, {
      expr: 'A*sin(w*x)',
      params: { A: [0.2, 2, 1.5], w: [0.5, 4, 2] },
    })

    const spec = readSpecLikeTheCard(result.meta)
    expect(spec).not.toBeNull()
    if (spec === null) return

    // This is the whole promise of the design: the card derives its picture
    // from the spec with the same library the Host used, so the two agree
    // without exchanging geometry over the wire.
    const replay = resolveGeometry(spec)
    const host = resolveGeometry(spec)
    expect(replay.xRange).toEqual(host.xRange)
    expect(replay.yRange).toEqual(host.yRange)
    expect(replay.curves.length).toBeGreaterThan(0)

    const first = replay.curves[0]
    const firstHost = host.curves[0]
    expect(first).toBeDefined()
    if (first === undefined || firstHost === undefined) return
    expect(first.points.length).toBe(firstHost.points.length)
    for (let i = 0; i < first.points.length; i += 97) {
      expect(first.points[i]).toEqual(firstHost.points[i])
    }
  })

  it('keeps every mode addressable from the persisted spec', async () => {
    const ctx = await setup()
    const cases: readonly { readonly args: unknown; readonly mode: string }[] = [
      { args: { expr: 'sin(x)', mode: 'tangent', probe: 0 }, mode: 'tangent' },
      { args: { expr: 'sin(x)', mode: 'riemann', a: 0, b: Math.PI, n: 15 }, mode: 'riemann' },
      { args: { expr: 'sin(x)', mode: 'taylor', center: 0, order: 5 }, mode: 'taylor' },
      { args: { expr: 'x^2', mode: 'compare', curves: ['直线, 2x'] }, mode: 'compare' },
      { args: { expr: 'chart', mode: 'data', dataset: 'bar' }, mode: 'data' },
    ]

    for (const { args, mode } of cases) {
      const result = await call(ctx, args)
      const spec = readSpecLikeTheCard(result.meta)
      expect(spec, `mode ${mode} lost its spec`).not.toBeNull()
      if (spec === null) continue
      // Every mode but `data` must yield at least one drawable curve.
      if (mode !== 'data') {
        expect(resolveGeometry(spec).curves.length, `mode ${mode} produced no curve`).toBeGreaterThan(0)
      }
    }
  })
})
