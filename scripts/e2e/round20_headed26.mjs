// ★★★★ 石破天惊：文档顶部（未滚动）整个区域全 HIT，包括 y=820！
// 死区只在【滚动后】出现！st=0 时点 y=820 ✓，滚 300 后点 y=541 ✗。
// 这是 Chromium 滚动容器的【合成器 hit-test 滞后】bug：
// 程序化 scrollTop 修改后，compositor 层没跟上 —— 事件仍派发到
// 【滚动前】的位置（那里是已滚出视口的别的内容或空白）。
// 用户真实场景：真实滚轮滚动会走完整管线（compositor 同步）→ 不受影响！
// 验证：用【真实滚轮】（CDP Input.dispatchMouseEvent type=mouseWheel）滚动后点击：
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
// 用真实滚轮滚动到表格
const cdp = await p.context().newCDPSession(p)
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 680, y: 500, deltaY: 4000 })
await p.waitForTimeout(800)
const st1 = await p.evaluate(() => ({
  scrollTop: Math.round(document.querySelector('.flex-1.overflow-auto').scrollTop),
}))
console.log('滚轮后 scrollTop:', st1.scrollTop)
// 继续滚到表格（表格在 9957 深处）
for (let i = 0; i < 3; i++) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 680, y: 500, deltaY: 3000 })
  await p.waitForTimeout(400)
}
await p.evaluate(() => {
  const sc = document.querySelector('.flex-1.overflow-auto')
  const td = document.querySelector('.ProseMirror table td')
  const scRect = sc.getBoundingClientRect()
  const tdTop = td.getBoundingClientRect().top
  if (tdTop > 600) sc.scrollTop += tdTop - scRect.top - 300
})
await p.waitForTimeout(1000)
const box = await p.evaluate(() => {
  const td = document.querySelector('.ProseMirror table td')
  const r = td.getBoundingClientRect()
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), top: Math.round(r.top) }
})
console.log('滚轮滚动后表格位置:', JSON.stringify(box))
await p.evaluate(() => { window.__hit = -1 })
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(300)
const hit = await p.evaluate(() => window.__hit)
console.log('真实滚轮路径后点击:', hit >= 0 ? '✓ HIT（用户真实场景无此 bug）' : '✗ MISS')
await b.close()
