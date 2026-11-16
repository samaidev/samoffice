// ★★★★★ 决定性！触摸（touchstart → pointerdown:SPAN）事件正常到达！
// 同一点：鼠标点击死、触摸点击活。
// → 鼠标管线 vs 触摸管线在 Chromium 内部分叉点 = **合成器 hit-test 的
// "鼠标事件命中层"**。触摸直接走主线程 hit-test。
// 这是 Chromium 坐标换算 bug 的铁证 —— 而我们的页面里有：
// editorScroll.scrollTop=9441 + transform:scale(1) 的缩放层。
// scale(1) 的矩阵是 identity —— 但 Chromium 对「有 transform 的层」
// 走 rarer 路径。段落 y=499 活 vs TD y=516 死 —— 位置非常接近！
// 一定不是"表格区"而是「精确到某条 y 分界线」！扫描：从 y=460 到 600 每 8px 点击
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(800)
const buf = fs.readFileSync(DOC)
const form = new FormData()
form.append('file', new Blob([buf]), 'contract.docx')
const r = await fetch(BASE + '/api/doc/open', { method: 'POST', body: form })
const j = await r.json()
await p.evaluate(d => window.__setDocForTest(d), j.document)
await p.waitForTimeout(3500)
await p.evaluate(() => { [...document.querySelectorAll('.ProseMirror td')][2].scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(1200)
const x = await p.evaluate(() => {
  const r = [...document.querySelectorAll('.ProseMirror td')][2].getBoundingClientRect()
  window.__scan = []
  window.addEventListener('pointerdown', e => window.__scan.push(Math.round(e.clientY)), { capture: true, passive: true })
  return Math.round(r.x + r.width / 2)
})
const res = []
for (let y = 460; y <= 620; y += 8) {
  await p.mouse.click(x, y)
  await p.waitForTimeout(60)
}
const got = await p.evaluate(() => window.__scan)
console.log('clicked y=460..620 step8, events received at y:', JSON.stringify(got))
await b.close()
