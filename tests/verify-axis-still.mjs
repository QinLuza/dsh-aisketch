/**
 * Proves the AXIS stays put during a parameter sweep.
 *
 * Same Playwright prerequisite as verify-anim.mjs (see that file's header).
 *
 * Measurement notes learned the hard way:
 *  - COLORS.grid is rgba(0,0,0,.07) — 7% opacity on a transparent backing, so
 *    it is nearly invisible and unusable as a probe.
 *  - COLORS.axis is #9aa0a6 = rgb(154,160,166), drawn opaque. Reliable landmark.
 *  - A symmetric wave like A*sin(x) is a BAD probe: its range is always centred
 *    on 0, so the axis row never moves even when auto-fit runs. We use an
 *    asymmetric expression (A + sin(...)) so that re-fitting genuinely shifts
 *    the vertical centre — making the test able to fail.
 */
import { chromium } from 'playwright'
import { fileURLToPath } from 'url'
import path from 'path'

const here = path.dirname(fileURLToPath(import.meta.url))
const target = 'file://' + path.join(here, '..', 'AISketch.standalone.html').split(path.sep).join('/')
const CHROME =
  process.env.SKETCH_CHROME ||
  'C:\\Users\\chine\\AppData\\Local\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe'

const EXPR = 'A+sin(x)'

const browser = await chromium.launch({ executablePath: CHROME, headless: true })
const page = await browser.newPage({ viewport: { width: 960, height: 720 } })
await page.goto(target)
await page.waitForTimeout(400)

await page.evaluate((expr) => {
  const el = document.querySelector('#expr')
  el.value = expr
  el.dispatchEvent(new Event('input', { bubbles: true }))
  const mode = document.querySelector('#mode')
  mode.value = 'plain'
  mode.dispatchEvent(new Event('change', { bubbles: true }))
}, EXPR)
await page.waitForTimeout(150)

const out = await page.evaluate(() => {
  const canvas = document.querySelector('canvas')
  const ctx = canvas.getContext('2d')
  const { width, height } = canvas

  /** Row index of the opaque horizontal axis line, or -1 if absent. */
  const axisRow = () => {
    const data = ctx.getImageData(0, 0, width, height).data
    let bestRow = -1
    let bestCount = 0
    for (let y = 0; y < height; y++) {
      let n = 0
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4
        if (
          Math.abs(data[i] - 154) < 26 &&
          Math.abs(data[i + 1] - 160) < 26 &&
          Math.abs(data[i + 2] - 166) < 26
        )
          n++
      }
      if (n > bestCount) {
        bestCount = n
        bestRow = y
      }
    }
    return bestCount > width * 0.5 ? bestRow : -1
  }

  const setA = (v) => {
    const s = document.querySelector('input[data-p="A"]')
    s.value = String(v)
    s.dispatchEvent(new Event('input', { bubbles: true }))
  }

  // Static control: without the animation the axis is expected to re-fit, so
  // this pair SHOULD differ — proving the probe is sensitive.
  setA(-2)
  const staticLow = axisRow()
  setA(4)
  const staticHigh = axisRow()

  // Animated: production play path freezes the range for the whole sweep.
  document.querySelector('#play').click()
  const frozen = []
  for (let t = 0; t <= 160; t += 20) {
    const A = 1.1 + 0.9 * Math.sin(t * 0.06)
    setA(A)
    frozen.push({ A: +A.toFixed(3), row: axisRow() })
  }
  document.querySelector('#play').click()

  return { width, height, staticLow, staticHigh, frozen }
})

await browser.close()

console.log('表达式:', EXPR, '（非对称，自适应时轴线会真的移动）')
console.log('canvas:', out.width, 'x', out.height)
console.log('')
console.log(`静止模式 x 轴行: A=-2 -> y=${out.staticLow}    A=4 -> y=${out.staticHigh}`)
console.log('')
console.log('动画模式 x 轴行随振幅变化:')
for (const f of out.frozen) console.log(`  A=${f.A.toFixed(3)} -> y=${f.row}`)
console.log('')

const rows = out.frozen.map((f) => f.row)
const distinct = [...new Set(rows)]
let failed = false

if (out.staticLow === -1 || out.staticHigh === -1) {
  // An off-canvas axis (-1) is not a broken probe here: with A=4 the whole
  // curve sits above zero, so auto-fit pushes the x-axis off the bottom. That
  // is itself proof the probe tracks the range.
  if (out.staticLow !== out.staticHigh) {
    console.log('PASS 对照组证明探针灵敏: 自适应把 x 轴推出画面（A=-2 在 y=' + out.staticLow + ', A=4 出界）')
  } else {
    console.log('FAIL 探测不到 x 轴，测量方法失效')
    failed = true
  }
} else if (out.staticLow === out.staticHigh) {
  console.log('WARN 静止对照组没有移动，本用例无法证伪')
  failed = true
} else {
  console.log(`PASS 对照组证明探针灵敏: 静止时轴线从 ${out.staticLow} 移到 ${out.staticHigh}`)
}

if (distinct.length === 1 && distinct[0] !== -1) {
  console.log(`PASS 动画全程 x 轴固定在 y=${distinct[0]}，坐标系纹丝不动`)
} else if (distinct[0] !== -1) {
  console.log(`FAIL x 轴在动画中移动了: ${distinct.join(' / ')}`)
  failed = true
}

console.log('')
console.log(failed ? '结论: 未通过' : '结论: 通过 —— 动画改变的是曲线，不是坐标系')
if (failed) process.exitCode = 1
