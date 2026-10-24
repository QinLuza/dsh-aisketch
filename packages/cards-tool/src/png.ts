/**
 * A minimal PNG encoder: 8-bit RGBA, filter 0, one IDAT.
 *
 * The preview pipeline must not add a native image dependency to the plugin --
 * no `sharp`, no `resvg`, no browser -- so the last mile is written here. PNG is
 * a container around a zlib stream, and both halves of that (the chunk framing
 * and `node:zlib`) are small and stable; the encoder deliberately does not
 * choose filters, because the pictures it encodes are flat-colored drawings on a
 * flat background, which deflate compresses well without prediction.
 */

import { deflateSync } from 'node:zlib'

/** The eight bytes every PNG starts with. */
const SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Cyclic redundancy table, built once. */
const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
})()

/** CRC-32 over a byte range. */
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (let index = 0; index < bytes.length; index += 1) {
    crc = CRC_TABLE[(crc ^ bytes[index]!) & 0xff]! ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** Build one length-prefixed, CRC-terminated PNG chunk. */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  for (let index = 0; index < 4; index += 1) out[4 + index] = type.charCodeAt(index)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

/**
 * Encode 8-bit RGBA pixels as a PNG.
 * @param width - pixel width.
 * @param height - pixel height.
 * @param rgba - row-major RGBA bytes, exactly `width * height * 4` long.
 * @returns the complete PNG file bytes.
 */
export function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const expected = width * height * 4
  if (rgba.length !== expected) {
    throw new Error(`encodePng: expected ${expected} RGBA bytes for ${width}x${height}, got ${rgba.length}`)
  }

  const header = new Uint8Array(13)
  const headerView = new DataView(header.buffer)
  headerView.setUint32(0, width)
  headerView.setUint32(4, height)
  header[8] = 8 // bit depth
  header[9] = 6 // color type: truecolour with alpha
  header[10] = 0 // deflate
  header[11] = 0 // adaptive filtering
  header[12] = 0 // no interlace

  // One filter-0 byte per scanline, then the raw samples.
  const stride = width * 4
  const raw = new Uint8Array((stride + 1) * height)
  for (let row = 0; row < height; row += 1) {
    raw[row * (stride + 1)] = 0
    raw.set(rgba.subarray(row * stride, (row + 1) * stride), row * (stride + 1) + 1)
  }

  const parts = [
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', new Uint8Array(deflateSync(raw, { level: 9 }))),
    chunk('IEND', new Uint8Array(0)),
  ]
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}
