/**
 * Headless verification of the AISketch browser card.
 *
 * The unit tests exercise the renderer against a recording stub, which proves
 * the right primitives are emitted but says nothing about what lands on screen.
 * This script closes that gap: it bundles the real `render.ts` plus
 * `@aisketch/sketch-core`, paints the six modes into a real canvas in real Chromium,
 * and measures the resulting pixels.
 *
 * Prerequisite (one-off; this folder has no package.json on purpose so the
 * browser test stays opt-in):
 *     mkdir -p tests/node_modules
 *     cp -r <playwright-pkg> <playwright-core-pkg> tests/node_modules/
 * Browsers: point SKETCH_CHROME at an existing Chromium if the default path is
 * absent. Nothing is downloaded automatically. vite is imported by absolute
 * path because ESM resolution ignores NODE_PATH.
 *
 * Every assertion here is paired with a control that can fail. The curve probe
 * counts only saturated blue pixels (the curve stroke, measured as
 * rgb(55,138,221)); the axis probe counts only the opaque grey axis
 * (rgb(154,160,166)). The grid colour is rgba(0,0,0,.07) and is useless as a
 * probe.
 */

import { chromium } from 'playwright'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const pkgRoot = path.resolve(here, '..', 'packages')
const ownRoot = path.resolve(here, '..')

const viteEntry = process.env.SKETCH_VITE
  || path.join(ownRoot, 'node_modules', '.pnpm', 'vite@8.3.1', 'node_modules', 'vite', 'dist', 'node', 'index.js')
const { build } = await import(pathToFileURL(viteEntry).href)

const CHROME =
  process.env.SKETCH_CHROME ||
  'C:\\Users\\chine\\AppData\\Local\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe'

/** Bundle the browser half into one ESM module the page can inline. */
async function bundle() {
  const dir = mkdtempSync(path.join(tmpdir(), 'aisketch-verify-'))
  const entry = path.join(dir, 'entry.js')
  writeFileSync(entry, [
    "import { resolveGeometry } from '@aisketch/sketch-core'",
    "import { COLORS, Viewport, drawAxes, drawCurve, drawCartesianChart, drawPieChart, drawPoint, drawRiemann } from 'render'",
    'globalThis.AISketch = { resolveGeometry, COLORS, Viewport, drawAxes, drawCurve, drawCartesianChart, drawPieChart, drawPoint, drawRiemann }',
  ].join('\n'))

  const result = await build({
    root: dir,
    logLevel: process.env.SKETCH_VITE_QUIET === '1' ? 'silent' : 'warn',
    resolve: {
      alias: {
        '@aisketch/sketch-core': path.join(pkgRoot, 'sketch-core', 'src', 'index.ts'),
        render: path.join(pkgRoot, 'client-ui-sketch', 'src', 'client', 'render.ts'),
      },
    },
    build: {
      write: true,
      outDir: path.join(dir, 'out'),
      emptyOutDir: true,
      minify: false,
      lib: { entry, formats: ['es'], fileName: 'bundle' },
    },
  })

  // The emitted extension follows the entry's, so read it back from vite
  // instead of assuming `.js`.
  if (result === undefined) throw new Error('vite build returned nothing')
  const outputs = Array.isArray(result) ? result.flatMap((r) => r.output ?? []) : (result.output ?? [])
  const chunk = outputs.find((o) => o.type === 'chunk' && o.isEntry)
  if (chunk === undefined) {
    throw new Error('vite emitted no entry chunk: ' + outputs.map((o) => o.fileName).join(', '))
  }
  console.log('  vite: ' + chunk.fileName)

  return { dir, out: path.join(dir, 'out', chunk.fileName) }
}

const { dir, out } = await bundle()

// A file:// page cannot import a bare path, so the bundle is inlined.
const bundleSource = readFileSync(out, 'utf8')
const pageFile = path.join(dir, 'page.html')
writeFileSync(pageFile, `<!doctype html>
<html><body style="margin:0;background:#fff">
<canvas id="c" width="620" height="380"></canvas>
<script type="module">${bundleSource}</script>
</body></html>`)

const browser = await chromium.launch({ executablePath: CHROME, headless: true })
const page = await browser.newPage({ viewport: { width: 700, height: 440 } })

const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))

await page.goto('file://' + pageFile.split(path.sep).join('/'))
await page.waitForTimeout(300)

const probe = await page.evaluate(() => {
  const api = globalThis.AISketch
  if (api === undefined) return { error: 'bundle did not expose AISketch' }
  const canvas = document.getElementById('c')
  const ctx = canvas.getContext('2d')

  /** All pixels of one colour, as row counts plus the first/last x seen. */
  const pixelsOf = (r0, g0, b0, tol) => {
    const { width, height } = canvas
    const data = ctx.getImageData(0, 0, width, height).data
    const rows = new Array(height).fill(0)
    let count = 0
    let minX = width
    let maxX = -1
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 4
        if (Math.abs(data[i] - r0) <= tol && Math.abs(data[i + 1] - g0) <= tol && Math.abs(data[i + 2] - b0) <= tol) {
          rows[y] += 1
          count += 1
          if (x < minX) minX = x
          if (x > maxX) maxX = x
        }
      }
    }
    return { rows, count, minX, maxX }
  }

  const stats = (p) => {
    let top = -1
    let bottom = -1
    for (let y = 0; y < p.rows.length; y += 1) {
      if (p.rows[y] > 0) {
        if (top < 0) top = y
        bottom = y
      }
    }
    return {
      count: p.count,
      xSpan: p.maxX < 0 ? 0 : p.maxX - p.minX,
      yTop: top,
      yBottom: bottom,
      ySpan: top < 0 ? 0 : bottom - top,
    }
  }

  /**
   * Paint like the card does: a spec plus an optional held y-window.
   * `frozenYRange` is the API the card itself uses to keep a sweep steady.
   */
  const paint = (spec, frozenYRange) => {
    const geometry = api.resolveGeometry(spec, frozenYRange === undefined ? {} : { frozenYRange })
    const vp = new api.Viewport(
      geometry.xRange[0], geometry.xRange[1],
      geometry.yRange.yMin, geometry.yRange.yMax,
    ).fit(620, 380)
    ctx.clearRect(0, 0, 620, 380)
    api.drawAxes(ctx, vp)
    geometry.curves.forEach((curve, i) => {
      api.drawCurve(ctx, vp, curve.points.map((p) => [p.x, p.y]), api.COLORS.curve[i % api.COLORS.curve.length])
    })
    return geometry
  }

  const nonWhite = () => {
    const data = ctx.getImageData(0, 0, 620, 380).data
    let n = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < 250 || data[i + 1] < 250 || data[i + 2] < 250) n += 1
    }
    return n
  }

  const out = {}

  // 1. A tall wave against a nearly flat line inside ONE held y-window (the
  //    `frozenYRange` the card uses for sweeps). `resolveGeometry` auto-fits y
  //    to each expression on its own, so comparing two separately-fitted curves
  //    would compare two identical full-frame spans and prove nothing.
  const HELD = { yMin: -1.2, yMax: 1.2 }
  paint({ expr: 'sin(x)' }, HELD)
  out.sin = stats(pixelsOf(55, 138, 221, 40))
  paint({ expr: 'sin(x)/50' }, HELD)
  out.flat = stats(pixelsOf(55, 138, 221, 40))

  // 1b. Auto-fit is what the card shows by default: both curves fill the frame.
  paint({ expr: 'sin(x)' })
  out.sinAuto = stats(pixelsOf(55, 138, 221, 40))
  paint({ expr: 'sin(x)/50' })
  out.flatAuto = stats(pixelsOf(55, 138, 221, 40))

  // 2. The axis is opaque grey; the grid is not, so a grid-coloured probe would
  //    report a wrong (or missing) row.
  paint({ expr: 'sin(x)' })
  const axis = pixelsOf(154, 160, 166, 12)
  out.axis = { rows: axis.rows.filter((n) => n > 300).length, count: axis.count }

  // 3. Every mode must put real content on the frame.
  const modes = {
    plain: { expr: 'sin(x)' },
    compare: { expr: 'x^2', mode: 'compare', compare: ['直线, 2x'] },
    tangent: { expr: 'sin(x)', mode: 'tangent', probe: 0 },
    riemann: { expr: 'sin(x)', mode: 'riemann', a: 0, b: 3.14159, n: 15 },
    taylor: { expr: 'sin(x)', mode: 'taylor', center: 0, order: 5 },
  }
  out.modes = {}
  for (const [name, spec] of Object.entries(modes)) {
    const geometry = paint(spec)
    out.modes[name] = { nonWhite: nonWhite(), curves: geometry.curves.length }
  }

  // 4. The chart modes take a separate path and must also fill the frame.
  const vp = new api.Viewport(0, 1, 0, 1).fit(620, 380)
  ctx.clearRect(0, 0, 620, 380)
  api.drawCartesianChart(ctx, vp, [
    { label: 'A', data: [72, 85, 63, 90, 78] },
    { label: 'B', data: [80, 88, 70, 94, 83] },
  ], 'bar')
  out.barNonWhite = nonWhite()

  ctx.clearRect(0, 0, 620, 380)
  api.drawPieChart(ctx, vp, [{ label: 'x', data: [35, 25, 20, 12, 8] }])
  out.pieNonWhite = nonWhite()

  return out
})

await browser.close()
rmSync(dir, { recursive: true, force: true })

console.log('console errors:', errors.length ? errors : 'none')
console.log('')
console.log(JSON.stringify(probe, null, 2))
console.log('')

let failed = false
const check = (label, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : `  (${detail})`}`)
  if (!ok) failed = true
}

if (probe.error !== undefined) {
  console.log('FAIL  bundle: ' + probe.error)
  failed = true
} else {
  check('plain curve draws', probe.sinAuto.ySpan > 40, `ySpan=${probe.sinAuto.ySpan}px, px=${probe.sinAuto.count}`)
  check(
    'probe is sensitive (held window separates tall wave from flat line)',
    probe.sin.ySpan > probe.flat.ySpan + 30,
    `${probe.sin.ySpan}px vs ${probe.flat.ySpan}px`,
  )
  check(
    'frozenYRange is honoured (auto-fit gives both curves full height)',
    probe.sinAuto.ySpan > 300 && probe.flatAuto.ySpan > 300,
    `${probe.sinAuto.ySpan}px / ${probe.flatAuto.ySpan}px`,
  )
  check('opaque axis row present', probe.axis.rows >= 1, `rows=${probe.axis.rows}`)
  check('bar chart fills the frame', probe.barNonWhite > 500, `pixels=${probe.barNonWhite}`)
  check('pie chart fills the frame', probe.pieNonWhite > 500, `pixels=${probe.pieNonWhite}`)
  const empties = Object.entries(probe.modes).filter(([, v]) => v.nonWhite < 200).map(([k]) => k)
  check('every function mode renders content', empties.length === 0, empties.length ? `empty: ${empties}` : 'all five')
  check('no console errors', errors.length === 0, errors.join('; ') || 'none')
}

if (failed) process.exitCode = 1
