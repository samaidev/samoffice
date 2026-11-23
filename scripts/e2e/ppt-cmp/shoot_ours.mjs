// round58：PPT 解析保真度对比 —— 逐页截图我方渲染（.slide-canvas 元素级截图）
import { chromium } from 'playwright'

const OFFICE = 'http://localhost:18400'
const PPTX = '/home/z/my-project/upload/装备工业的互联网 机遇.pptx'
const OUT = '/home/z/my-project/samoffice/scripts/e2e/ppt-cmp/ours'

const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
p.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 200)))
await p.goto(OFFICE, { waitUntil: 'networkidle', timeout: 30000 })
await p.waitForTimeout(800)
await p.evaluate(() => { localStorage.setItem('samoffice_lang', 'zh') })
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(1000)

await p.locator('[data-testid="menu-files"]').click({ force: true }); await p.waitForTimeout(400)
const [ch] = await Promise.all([
  p.waitForEvent('filechooser', { timeout: 10000 }),
  (async () => { await p.locator('text=📂').first().click({ force: true }) })(),
])
await ch.setFiles(PPTX)
await p.waitForTimeout(3500)

const n = await p.evaluate(() => document.querySelectorAll('.slide-canvas').length)
const total = await p.evaluate(() => {
  const ths = document.querySelectorAll('[data-testid^="ppt-browse-card-"]')
  return ths.length || document.querySelectorAll('aside .space-y-2 > div').length || 0
})
console.log('canvas:', n, 'thumbs (via browse):', total)

// 用左侧缩略图逐页切换 + 截主画布
const thumbs = p.locator('div.cursor-pointer .rounded.overflow-relative, .w-40 .space-y-2 > div, .w-48 .space-y-2 > div')
const thumbCount = await thumbs.count()
console.log('thumb locators:', thumbCount)

// 逐页：点左侧缩略图 → 等渲染 → 截画布
for (let i = 0; i < 16; i++) {
  const ok = await p.evaluate((idx) => {
    const list = document.querySelector('.w-40, .w-48')
    if (!list) return false
    const cards = list.querySelectorAll('.space-y-2 > div')
    if (cards[idx]) { cards[idx].dispatchEvent(new MouseEvent('click', { bubbles: true })); return true }
    return false
  }, i)
  if (!ok) { console.log(`slide ${i + 1}: no thumbnail clicked`); continue }
  await p.waitForTimeout(700)
  const canvas = p.locator('.slide-canvas').first()
  await canvas.screenshot({ path: `${OUT}/s${String(i + 1).padStart(2, '0')}.png` })
  console.log(`slide ${i + 1} captured`)
}
await b.close()
console.log('done')
