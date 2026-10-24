/**
 * `show_card` preview tests: a drawing comes back as a picture.
 *
 * The plugin is driven through the real registry, with stand-in `attachments`
 * and `llm` services provided on the context, so this exercises the same path a
 * live call does: execute, rasterize, commit the image, and render content
 * blocks. The degradation cases matter as much as the happy path -- a card tool
 * must still work on a host with no attachment store, or on a route that cannot
 * read images.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolExecutionInput } from '@deepseek-ai/dsh-tools'
import * as cardsTool from '../src/index.ts'

const signal = new AbortController().signal

/** One admissible sketch: a filled sky band plus a triangle and a caption. */
const sketch = {
  size: { w: 200, h: 120 },
  paper: 'plain',
  elements: [
    { type: 'shape', shape: 'rect', x: 0, y: 0, w: 200, h: 60, fill: 'blue', color: 'blue', width: 0.3 },
    { type: 'shape', shape: 'triangle', x: 40, y: 60, w: 120, h: 50, fill: 'green', color: 'green', width: 2 },
    { type: 'text', x: 40, y: 40, text: '山湖', size: 18, color: 'white', bold: true },
  ],
}

/** A saved-image stub that decodes the PNG header, so the assertion sees real dimensions. */
interface SavedImage {
  readonly attachmentId: string
  readonly mediaType: 'image/png'
  readonly bytes: number
  readonly width: number
  readonly height: number
  readonly name: string
}

interface AttachmentStub {
  readonly imageLimits: {
    readonly mediaTypes: readonly string[]
    readonly maxImageBytes: number
    readonly maxMessageImageBytes: number
  }
  saveImage(input: { data: Uint8Array; mediaType: 'image/png'; name: string }): Promise<SavedImage>
}

/** Record what was committed, so a test can inspect the actual PNG bytes. */
function recorder(): { stub: AttachmentStub; saved: Uint8Array[] } {
  const saved: Uint8Array[] = []
  const stub: AttachmentStub = {
    imageLimits: { mediaTypes: ['image/png'], maxImageBytes: 4_000_000, maxMessageImageBytes: 4_000_000 },
    async saveImage(input) {
      saved.push(input.data)
      const view = new DataView(input.data.buffer, input.data.byteOffset, input.data.byteLength)
      return {
        attachmentId: 'att-preview',
        mediaType: 'image/png',
        bytes: input.data.length,
        width: view.getUint32(16) ?? 0,
        height: view.getUint32(20) ?? 0,
        name: input.name,
      }
    },
  }
  return { stub, saved }
}

/** The image content blocks of one tool result. */
function imagesOf(content: readonly { type: string }[]): readonly Record<string, unknown>[] {
  return content.filter(block => block.type === 'image') as unknown as Record<string, unknown>[]
}

/** The model-facing text of one tool result. */
function textOf(content: readonly { type: string; text?: string }[]): string {
  return content.map(block => block.text ?? '').join('\n')
}

function call(args: unknown): ToolExecutionInput {
  return { signal, callId: ToolCallId('c1'), name: 'show_card', arguments: args, agent: fakeAgent as never }
}

/**
 * The stand-in agent. The preview gate reads the routed provider/model off the
 * call, exactly as `read_image` does, so a synthetic execution needs to look
 * like an agent-driven one before the picture can be attached.
 */
const fakeAgent = {
  session: { requestHeader: () => ({ config: { provider: 'stub', model: 'stub-vision' } }) },
  options: { provider: 'stub', model: 'stub-vision' },
}

let ctx: Context
let savedImages: Uint8Array[]

beforeEach(async () => {
  ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const { stub, saved } = recorder()
  savedImages = saved
  ctx.provide('attachments', stub)
  ctx.provide('llm', { resolveModelInfo: async () => ({ inputModalities: ['text', 'image'] }) })
  await ctx.plugin(cardsTool)
})

describe('a drawing comes back to its author', () => {
  it('returns an image block beside the summary', async () => {
    const result = await ctx.tools.execute(call({ kind: 'draw', title: '山湖', payload: sketch }))
    expect(result.isError).toBeFalsy()
    const images = imagesOf(result.content)
    expect(images).toHaveLength(1)
    expect(images[0]).toMatchObject({ type: 'image', attachment: { attachmentId: 'att-preview', mediaType: 'image/png' } })
  })

  it('commits the exact bytes the preview describes', async () => {
    const result = await ctx.tools.execute(call({ kind: 'draw', payload: sketch }))
    expect(savedImages).toHaveLength(1)
    const png = savedImages[0]!
    expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
    const images = imagesOf(result.content)
    const attachment = (images[0] as { attachment: SavedImage }).attachment
    expect(attachment.bytes).toBe(png.length)
    // The preview is the card's own canvas, so its size is the payload's size.
    expect(attachment.width).toBe(200)
    expect(attachment.height).toBe(120)
  })

  it('reports the machine self-check in the same text block', async () => {
    const result = await ctx.tools.execute(call({ kind: 'draw', payload: sketch }))
    const text = textOf(result.content)
    expect(text).toContain('Showed a "draw" card')
    expect(text).toContain('<self-check>')
    expect(text).toContain('canvas 200x120')
    expect(text).toContain('</self-check>')
    expect(text).not.toContain('add 1-3')
  })

  it('leaves art direction to the prompt instead of appending a house-style note', async () => {
    const result = await ctx.tools.execute(call({ kind: 'draw', payload: sketch }))
    const text = textOf(result.content)
    expect(text).not.toContain('full-width bands')
    expect(text).not.toContain('field-notebook')
  })

  it('labels a draft as private while still returning its preview', async () => {
    const result = await ctx.tools.execute(call({ kind: 'draw', payload: sketch, draft: true }))
    expect(imagesOf(result.content)).toHaveLength(1)
    expect(textOf(result.content)).toContain('private draft')
  })

  it('names a structural fault the author can fix', async () => {
    const faraway = {
      size: { w: 200, h: 120 },
      elements: [
        { type: 'shape', shape: 'rect', x: 0, y: 0, w: 200, h: 120, fill: 'white', color: 'white', width: 0.3 },
        { type: 'shape', shape: 'rect', x: 400, y: 300, w: 40, h: 40, color: 'red', width: 2 },
      ],
    }
    const result = await ctx.tools.execute(call({ kind: 'draw', payload: faraway }))
    expect(textOf(result.content)).toContain('draw nothing on the canvas')
  })

  it('skips the picture when preview is false', async () => {
    const result = await ctx.tools.execute(call({ kind: 'draw', payload: sketch, preview: false }))
    expect(imagesOf(result.content)).toHaveLength(0)
    expect(savedImages).toHaveLength(0)
    expect(textOf(result.content)).toContain('<self-check>')
  })

  it('leaves a table card exactly as it was', async () => {
    const result = await ctx.tools.execute(call({
      kind: 'table',
      payload: { columns: ['a'], rows: [['x']] },
    }))
    expect(imagesOf(result.content)).toHaveLength(0)
    expect(result.value).not.toHaveProperty('selfCheck')
    expect(savedImages).toHaveLength(0)
  })
})

describe('degrading without a camera', () => {
  it('still shows the card when no attachment store is mounted', async () => {
    const bare = new Context()
    await bare.plugin(SystemPrompt)
    await bare.plugin(ToolRuntime)
    bare.provide('llm', { resolveModelInfo: async () => ({ inputModalities: ['text', 'image'] }) })
    await bare.plugin(cardsTool)
    const result = await bare.tools.execute(call({ kind: 'draw', payload: sketch }))
    expect(result.isError).toBeFalsy()
    expect(imagesOf(result.content)).toHaveLength(0)
    expect(textOf(result.content)).toContain('preview skipped')
    expect(textOf(result.content)).toContain('no attachment store')
  })

  it('does not attach a picture to a route that cannot read one', async () => {
    const textOnly = new Context()
    await textOnly.plugin(SystemPrompt)
    await textOnly.plugin(ToolRuntime)
    const { stub, saved } = recorder()
    textOnly.provide('attachments', stub)
    textOnly.provide('llm', { resolveModelInfo: async () => ({ inputModalities: ['text'] }) })
    await textOnly.plugin(cardsTool)
    const result = await textOnly.tools.execute(call({ kind: 'draw', payload: sketch }))
    expect(imagesOf(result.content)).toHaveLength(0)
    expect(saved).toHaveLength(0)
    expect(textOf(result.content)).toContain('does not declare image input')
  })
})
