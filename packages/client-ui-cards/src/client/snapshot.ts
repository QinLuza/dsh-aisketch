/**
 * Bitmap snapshots of a draw card.
 *
 * A hand-drawn card is hundreds of SVG paths, and a handful of them carry
 * filters and gradients. Rasterizing that at every scroll and every expand
 * costs hundreds of milliseconds on a machine without GPU rasterization, which
 * is exactly the jank a transcript must not have. Once the picture exists it
 * never changes, so the card is rasterized once and pasted as a bitmap.
 *
 * Two things get lost when the markup leaves the page, so they are fixed here:
 * `var(--token, fallback)` does not resolve inside an image document, and a
 * class-based font does not travel with the node. The theme tokens are resolved
 * from the live page, the fonts are inlined by the renderer.
 */

/** How many cards keep their bitmap; enough for a screenful plus the overlay copy. */
const CACHE_LIMIT = 6

/** Long-edge ceiling, so one full-page scene cannot eat the whole GPU memory budget. */
const MAX_SNAPSHOT_EDGE = 1800

const cache = new Map<string, HTMLCanvasElement>()

/** Bitmaps still being rasterized, so the inline card and the overlay share one job. */
const pending = new Map<string, Promise<HTMLCanvasElement>>()

/** The cached bitmap for a card key, or undefined. */
export function cachedSnapshot(key: string): HTMLCanvasElement | undefined {
  return cache.get(key)
}

/** Remember one card's bitmap, evicting the oldest when the cache is full. */
export function storeSnapshot(key: string, canvas: HTMLCanvasElement): void {
  if (cache.has(key)) cache.delete(key)
  cache.set(key, canvas)
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

/** Drop every cached bitmap (theme change, tests). */
export function clearSnapshots(): void {
  cache.clear()
  pending.clear()
}

/**
 * Rasterize one card, reusing an in-flight job with the same key.
 *
 * The inline card and the expanded overlay render the same payload at nearly
 * the same moment; without this, expanding would rasterize a second copy.
 * @param key - payload + theme identity.
 * @param svg - this instance's mounted SVG, used when no job is in flight.
 * @param dpr - the page's device pixel ratio.
 * @returns the bitmap.
 */
export function snapshotFor(key: string, svg: SVGSVGElement, dpr: number): Promise<HTMLCanvasElement> {
  const running = pending.get(key)
  if (running !== undefined) return running
  const job = rasterizeSvg(svg, dpr).finally(() => pending.delete(key))
  pending.set(key, job)
  return job
}

/**
 * The device-pixel ratio a snapshot should use.
 *
 * At most 2, and at most enough to reach {@link MAX_SNAPSHOT_EDGE} on the long
 * edge: a 1200x800 scene lands at 1.5x, a 1600-wide one at 1.125x.
 * @param width - intrinsic canvas width.
 * @param height - intrinsic canvas height.
 * @param dpr - the page's device pixel ratio.
 * @returns the scale factor, never below 1.
 */
export function snapshotScale(width: number, height: number, dpr: number): number {
  const wanted = Math.min(Math.max(dpr, 1), 2)
  const room = MAX_SNAPSHOT_EDGE / Math.max(width, height, 1)
  return Math.max(1, Math.min(wanted, room))
}

/** Find the matching closing paren for a `var(` that starts at `open`. */
function closingParen(text: string, open: number): number {
  let depth = 0
  for (let index = open; index < text.length; index += 1) {
    const character = text[index]
    if (character === '(') depth += 1
    else if (character === ')') {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
}

/** The first top-level comma inside a `var()` body, or -1. */
function topLevelComma(body: string): number {
  let depth = 0
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index]
    if (character === '(') depth += 1
    else if (character === ')') depth -= 1
    else if (character === ',' && depth === 0) return index
  }
  return -1
}

/**
 * Replace every `var(--token, fallback)` with a concrete value.
 *
 * The value is read from the live document, so a dark theme yields light ink in
 * the bitmap; the fallback is used when the token is not defined. Nested
 * parentheses in a fallback (`rgba(…)`) are handled by scanning, not by a regex.
 * @param text - serialized SVG markup.
 * @param read - reads a custom property from the page.
 * @returns the markup with no `var()` left.
 */
export function resolveCssVariables(text: string, read: (name: string) => string): string {
  let output = ''
  let cursor = 0
  for (;;) {
    const start = text.indexOf('var(', cursor)
    if (start === -1) {
      output += text.slice(cursor)
      return output
    }
    const open = text.indexOf('(', start)
    const close = closingParen(text, open)
    if (close === -1) {
      output += text.slice(cursor)
      return output
    }
    const body = text.slice(open + 1, close)
    const comma = topLevelComma(body)
    const name = (comma === -1 ? body : body.slice(0, comma)).trim()
    const fallback = comma === -1 ? '' : body.slice(comma + 1).trim()
    const declared = name.startsWith('--') ? read(name).trim() : ''
    output += text.slice(cursor, start)
    output += declared.length > 0 ? declared : fallback
    cursor = close + 1
  }
}

/** Read a CSS custom property from the page root. */
function readToken(name: string): string {
  if (typeof window === 'undefined') return ''
  return window.getComputedStyle(document.documentElement).getPropertyValue(name)
}

/** The bitmap size a card should be rasterized at. */
export interface SnapshotGeometry {
  readonly width: number
  readonly height: number
}

/**
 * Rasterize one mounted SVG element into a canvas.
 *
 * The node is cloned and serialized rather than drawn from the live DOM, so the
 * live SVG can stay `display:none` and never pay rasterization itself. Fonts are
 * expected to be inline on the text nodes by the caller; theme tokens are
 * resolved here.
 * @param svg - the mounted (possibly hidden) SVG element.
 * @param dpr - the page's device pixel ratio.
 * @returns a canvas holding the picture, at device pixels.
 */
export async function rasterizeSvg(svg: SVGSVGElement, dpr: number): Promise<HTMLCanvasElement> {
  const width = Number(svg.getAttribute('width')) || svg.viewBox.baseVal.width
  const height = Number(svg.getAttribute('height')) || svg.viewBox.baseVal.height
  if (!(width > 0) || !(height > 0)) throw new Error('svg has no size')

  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  const markup = resolveCssVariables(new XMLSerializer().serializeToString(clone), readToken)
  const blob = new Blob([markup], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    const image = new Image()
    image.decoding = 'sync'
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('svg did not decode'))
      image.src = url
    })
    const scale = snapshotScale(width, height, dpr)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('no 2d context')
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return canvas
  } finally {
    URL.revokeObjectURL(url)
  }
}
