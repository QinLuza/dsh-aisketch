/**
 * Headless verification of the "moving axes" fix.
 *
 * Prerequisite (one-off, and this folder has no package.json on purpose so the
 * browser test stays opt-in):
 *     mkdir -p tests/node_modules
 *     cp -r <playwright-pkg> <playwright-core-pkg> tests/node_modules/
 * Browsers: point SKETCH_CHROME at an existing Chromium if the default path is
 * absent. Nothing is downloaded automatically.
 *
 * Starts from the real standalone build, sweeps the amplitude parameter exactly
 * as the animation does, and measures how tall the CURVE is drawn on screen by
 * counting pixels of the curve's own stroke colour. A frozen y-axis means the
 * curve's on-screen height must change a lot across the sweep.
 *
 * Curve stroke is rgb(55,138,221) — measured from the canvas, not assumed.
 */
import { chromium } from 'playwright'
import { fileURLToPath } from 'url'
import path from 'path'

const here = path.dirname(fileURLToPath(import.meta.url))
const target = 'file://' + path.join(here, '..', 'AISketch.standalone.html').split(path.sep).join('/')

const CHROME =
  process.env.SKETCH_CHROME ||
  'C:\\Users\\chine\\AppData\\Local\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe'

const browser = await chromium.launch({ executablePath: CHROME, headless: true })
const page = await browser.newPage({ viewport: { width: 960, height: 720 } })

const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))

await page.goto(target)
await page.waitForTimeout(400)

// Put the app into the plain 3-parameter sweep.
await page.evaluate(() => {
  const expr = document.querySelector('#expr')
  expr.value = 'A*sin(w*x+p)'
  expr.dispatchEvent(new Event('input', { bubbles: true }))
  const mode = document.querySelector('#mode')
  mode.value = 'plain'
  mode.dispatchEvent(new Event('change', { bubbles: true }))
})
await page.waitForTimeout(200)

// Freeze the range the way the play handler does, then step the sweep.
const result = await page.evaluate(() => {
  const canvas = document.querySelector('canvas')
  const ctx = canvas.getContext('2d')

  // Count curve-stroke pixels in each row (blue-dominant, saturated).
  const rowCounts = () => {
    const { width, height } = canvas
    const data = ctx.getImageData(0, 0, width, height).data
    const rows = new Array(height).fill(0)
    for (let y = 0; y < height; y++) {
      let n = 0
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4
        const r = data[i]
        const g = data[i + 1]
        const b = data[i + 2]
        // Match the curve stroke, not the grey grid.
        if (b > 180 && b - r > 100 && b - g > 60) n++
      }
      rows[y] = n
    }
    return rows
  }

  const measure = () => {
    const rows = rowCounts()
    let top = -1
    let bottom = -1
    for (let y = 0; y < rows.length; y++) {
      if (rows[y] > 0) {
        if (top < 0) top = y
        bottom = y
      }
    }
    return bottom - top
  }

  const slider = document.querySelector('input[data-p="A"]')
  const setA = (v) => {
    slider.value = String(v)
    slider.dispatchEvent(new Event('input', { bubbles: true }))
  }

  // Start the animation for real, so frozenY is set by the production path.
  document.querySelector('#play').click()

  const samples = []
  for (let t = 0; t <= 160; t += 10) {
    const A = 1.1 + 0.9 * Math.sin(t * 0.06)
    setA(A)
    samples.push({ t, A: +A.toFixed(3), height: measure() })
  }
  document.querySelector('#play').click() // stop

  return { samples }
})

await browser.close()

console.log('console errors:', errors.length ? errors : 'none')
console.log('')
console.log('tick     A     曲线上像素高度(px)')
for (const s of result.samples) {
  const bar = '#'.repeat(Math.max(1, Math.round(s.height / 6)))
  console.log(`${String(s.t).padStart(4)}  ${s.A.toFixed(3)}   ${String(s.height).padStart(4)}  ${bar}`)
}
const hs = result.samples.map((s) => s.height)
const spread = Math.max(...hs) - Math.min(...hs)
console.log('')
console.log(`曲线屏幕高度: min=${Math.min(...hs)}px max=${Math.max(...hs)}px 变化=${spread}px`)
console.log(spread > 40 ? 'PASS 曲线在固定坐标系内明显伸缩' : 'FAIL 曲线看起来没变化')
if (errors.length) process.exitCode = 1
