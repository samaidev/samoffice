import { chromium } from 'playwright'

const URLS = ['http://localhost:5173', 'http://localhost:34115']

const browser = await chromium.launch()
const page = await browser.newPage()
page.on('console', (m) => {
  const t = m.text()
  if (t.includes('__pg') || t.includes('pagination')) console.log('CONSOLE:', t)
})

let target = null
for (const u of URLS) {
  try {
    const r = await page.goto(u, { timeout: 30000, waitUntil: 'load' })
    if (r && r.ok()) { target = u; console.log('opened', u); break }
  } catch (e) { console.log('fail', u, e.message) }
}
if (!target) { console.log('no server'); await browser.close(); process.exit(1) }

// 等待分页引擎运行
await page.waitForTimeout(8000)

const pg = await page.evaluate(() => window.__pg || null)
const bt = await page.evaluate(() => window.__bodyTop || null)
console.log('=== __pg ===')
console.log(JSON.stringify(pg, null, 2))
console.log('=== __bodyTop ===')
console.log(JSON.stringify(bt, null, 2))

if (pg && bt) {
  const bodyTop = bt.bodyTop
  const p0Top = pg.pageRects[0]?.top ?? 0
  const pageBottomAbs = bodyTop + p0Top + pg.pageHeightPx // 纸页底（相对 pageRef）
  const firstBlockTop = pg.firstBlockCumTop
  const last = pg.lastLineOfFirstBlock
  if (last) {
    const contentBottomAbs = bodyTop + firstBlockTop + last.bottom // 首块最后一行底（相对 pageRef）
    console.log('--- 几何核对（单页，首块）---')
    console.log('纸页顶(abs)    =', bodyTop + p0Top)
    console.log('纸页底(abs)    =', pageBottomAbs)
    console.log('首块最后行底(abs)=', Math.round(contentBottomAbs))
    console.log('差值(纸页底-内容底)=', Math.round(pageBottomAbs - contentBottomAbs), '应≈ marginBottom=', bt.editorPaddingBottom)
    console.log('是否超下直角:', contentBottomAbs > pageBottomAbs + 1 ? 'YES 超界' : 'NO 未超')
  }
}
await browser.close()
