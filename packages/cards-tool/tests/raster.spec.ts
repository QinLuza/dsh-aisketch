/**
 * Rasterizer tests: the preview must actually paint pixels.
 *
 * These are deliberately pixel assertions rather than "it returned bytes": the
 * failure this pipeline exists to prevent is a model guessing at a picture it
 * cannot see, and a preview that silently renders blank would be worse than no
 * preview at all. Every case here compares real RGBA samples against the color
 * the payload asked for.
 */

import { describe, expect, it } from 'vitest'
import { buildDrawDisplayList, parseDrawPayload } from '@aisketch/cards-core'
import { rasterizeDisplayList, rasterizeDisplayListPng } from '../src/raster.ts'

/** The smallest canvas the payload contract admits. */
const CANVAS = { w: 160, h: 120 } as const

/** Build a display list from a payload literal, failing the test if it does not parse. */
function listOf(payload: unknown) {
  const draw = parseDrawPayload(payload)
  if (draw === null) throw new Error('test payload did not parse')
  return buildDrawDisplayList(draw)
}

/** A draw payload over the standard test canvas. */
function scene(elements: readonly unknown[]): unknown {
  return { size: CANVAS, paper: 'plain', elements }
}

/** The RGBA of one pixel. */
function pixelAt(rgba: Uint8Array, width: number, x: number, y: number): readonly [number, number, number, number] {
  const offset = (y * width + x) * 4
  return [rgba[offset]!, rgba[offset + 1]!, rgba[offset + 2]!, rgba[offset + 3]!]
}

/** A whole-canvas rectangle in a given fill color. */
function cover(fill: string): unknown {
  return { type: 'shape', shape: 'rect', x: 0, y: 0, w: CANVAS.w, h: CANVAS.h, fill, color: fill, width: 0.3 }
}

describe('rasterizing a display list', () => {
  it('returns an image at the canvas size, not at the supersampled size', () => {
    const image = rasterizeDisplayList(listOf(scene([cover('red')])))
    expect(image.width).toBe(CANVAS.w)
    expect(image.height).toBe(CANVAS.h)
    expect(image.rgba.length).toBe(CANVAS.w * CANVAS.h * 4)
  })

  it('paints a fill in the color the payload asked for', () => {
    // Pixel art is the one primitive the engine paints at full opacity, so it is
    // the honest probe for "did the color survive the pipeline".
    const grid = Array.from({ length: 12 }, () => '#'.repeat(16))
    const image = rasterizeDisplayList(
      listOf(scene([{ type: 'pixels', x: 0, y: 0, cell: 10, rows: grid, palette: { '#': 'green' } }])),
      { supersample: 1 },
    )
    for (const [x, y] of [[80, 60], [20, 20], [140, 100]] as const) {
      const [r, g, b, a] = pixelAt(image.rgba, image.width, x, y)
      // green is #188038
      expect(r).toBeLessThan(60)
      expect(g).toBeGreaterThan(110)
      expect(b).toBeLessThan(90)
      expect(a).toBe(255)
    }
  })

  it('leaves the parts of the canvas the drawing does not cover as paper', () => {
    const grid = Array.from({ length: 12 }, () => '#'.repeat(8))
    const image = rasterizeDisplayList(
      listOf(scene([{ type: 'pixels', x: 0, y: 0, cell: 10, rows: grid, palette: { '#': 'blue' } }])),
      { supersample: 1 },
    )
    const left = pixelAt(image.rgba, image.width, 24, 60)
    const right = pixelAt(image.rgba, image.width, 136, 60)
    expect(left[2]!).toBeGreaterThan(150)
    expect(left[0]!).toBeLessThan(120)
    expect(right[0]!).toBeGreaterThan(240)
    expect(right[1]!).toBeGreaterThan(240)
    expect(right[2]!).toBeGreaterThan(240)
  })

  it('composites a shape fill as the translucent tint the card shows', () => {
    const image = rasterizeDisplayList(listOf(scene([cover('red')])), { supersample: 1 })
    const [r, g, b] = pixelAt(image.rgba, image.width, 80, 60)
    // The engine paints shape fills at 25% over the paper, so red reads as a
    // pink tint rather than a flat swatch -- and the preview must say the same.
    expect(r).toBeGreaterThan(g)
    expect(r).toBeGreaterThan(b)
    expect(r).toBeLessThan(255)
    expect(r).toBeGreaterThan(200)
  })

  it('paints ink from text, so a caption is visible in the preview', () => {
    const image = rasterizeDisplayList(
      listOf(scene([{ type: 'text', x: 6, y: 70, text: '山湖小屋', size: 22, color: 'black', bold: true }])),
      { supersample: 1 },
    )
    let dark = 0
    for (let y = 48; y < 76; y += 1) {
      for (let x = 4; x < 156; x += 1) {
        const [r, g, b] = pixelAt(image.rgba, image.width, x, y)
        if (r < 120 && g < 120 && b < 120) dark += 1
      }
    }
    expect(dark).toBeGreaterThan(50)
  })

  it('paints pixel art cells', () => {
    const image = rasterizeDisplayList(
      listOf(scene([{ type: 'pixels', x: 0, y: 0, cell: 10, rows: ['##'], palette: { '#': 'green' } }])),
      { supersample: 1 },
    )
    const [r, g, b] = pixelAt(image.rgba, image.width, 5, 5)
    expect(g).toBeGreaterThan(100)
    expect(g).toBeGreaterThan(r)
    expect(g).toBeGreaterThan(b)
  })
})

describe('encoding the preview PNG', () => {
  it('writes a PNG signature, the canvas dimensions, and an IEND chunk', () => {
    const png = rasterizeDisplayListPng(listOf(scene([cover('red')])))
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
    expect(view.getUint32(16)).toBe(CANVAS.w)
    expect(view.getUint32(20)).toBe(CANVAS.h)
    expect(view.getUint8(24)).toBe(8)
    expect(view.getUint8(25)).toBe(6)
    const tail = new TextDecoder().decode(png.subarray(png.length - 8, png.length - 4))
    expect(tail).toBe('IEND')
  })

  it('produces a plausible file size for a flat drawing', () => {
    const png = rasterizeDisplayListPng(listOf(scene([cover('teal')])))
    expect(png.length).toBeGreaterThan(200)
    expect(png.length).toBeLessThan(200_000)
  })
})
