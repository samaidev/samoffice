// ★★★ 破案关键数字：scroller 顶 y=255，高 615 → 底=870。
// 死区边界：tdY>~260 MISS（= scroller 顶 255 + 一点余量）
// HIT 的全是 tdY < 255 的 —— 但 td 在 scroller 内怎么会在 y<255？！
// st=400 时 tdY=-16 —— 表格滚到 scroller 上方外面去了！
// 点击 (x, -16) 在 scroller 外 —— Playwright 会自动滚回 —— 那时事件 ✓。
// 
// ◆ 完整解释成型：
// Chromium 滚动容器的【渲染层合成 bug】（Xvfb 无 GPU 或 headless 下的
// compositor hit-test 与 layout 不同步）—— 但 headed8 段落 y=455 HIT 又如何解释？
// 那次点击的段落【不在滚动容器里】？不 —— PM 整个在 scroller 里。
// ……除非那次成功也是 Playwright 自动滚动造成的。
// 验证：headed8 的段落点击是 mouse.click(paraPt) —— paraPt 是提前算的固定坐标。
// 若点击时该坐标有元素则直点。之前成功了 —— 段落在 y=455 > 255 死区内竟 HIT？！
// 
// 别再猜了 —— 用铁的数据：扫描【正文段落】在不同 y 的点击（不自动滚，直接坐标点击）：
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const b = await chromium.launch({ args: ['--no-sandbox'], headless: false })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(15000)
await p.goto('http://localhost:18400', { waitUntil: 'networkidle' })
await p.evaluate(() => localStorage.setItem('samoffice_theme', 'light'))
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
const buf = fs.readFileSync(DOC)
const form = new FormData()
form.append('file', new Blob([buf]), 'contract.docx')
const r = await fetch('http://localhost:18400/api/doc/open', { method: 'POST', body: form })
const j = await r.json()
await p.evaluate(d => window.__setDocForTest(d), j.document)
await p.waitForTimeout(2500)
await p.evaluate(() => {
  window.__hit = -1
  if (!window.__mdHooked) { window.__mdHooked = true; window.addEventListener('mousedown', () => { window.__hit = 1 }, true) }
})
// 正文第一段（文档顶部，无需滚动）
await p.evaluate(() => { document.querySelector('.flex-1.overflow-auto').scrollTop = 0 })
await p.waitForTimeout(800)
const out = []
for (let y = 260; y <= 840; y += 80) {
  await p.evaluate(() => { window.__hit = -1 })
  await p.mouse.click(400, y)
  await p.waitForTimeout(150)
  const hit = await p.evaluate(() => window.__hit)
  out.push(`y=${y}:${hit >= 0 ? '✓' : '✗'}`)
}
console.log('文档顶部区域扫描:', out.join(' '))
await b.close()
