// headed 模式（真实 Xvfb 渲染管线）依然死区！这不是 Playwright headless 的锅，
// 是真实 bug —— 用户的桌面端也会遇到！
// 重新聚焦：点击 (309, 541) 无 mousedown —— 但 elementFromPoint 命中 SPAN。
// 有了真实渲染，截图看那个位置到底渲染了什么：
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
  const sc = document.querySelector('.flex-1.overflow-auto')
  const td = document.querySelector('.ProseMirror table td')
  const scRect = sc.getBoundingClientRect()
  const tdTop = td.getBoundingClientRect().top
  sc.scrollTop += tdTop - scRect.top - 300
})
await p.waitForTimeout(2000)
await p.screenshot({ path: 'scripts/e2e/round19-shots/headed-deadzone.png' })
// 用坐标标注：看看 (309,541) 附近截图里是什么
console.log('截图完成')
// 再试：点击 (309, 400) —— 表格上方的段落（活区）对照
await p.evaluate(() => {
  window.__hit = -1
  window.addEventListener('mousedown', e => { window.__hit = Math.round(e.clientY) }, true)
})
await p.mouse.click(309, 400)
await p.waitForTimeout(200)
const h400 = await p.evaluate(() => window.__hit)
await p.mouse.click(309, 480)
await p.waitForTimeout(200)
const h480 = await p.evaluate(() => window.__hit)
await p.mouse.click(309, 541)
await p.waitForTimeout(200)
const h541 = await p.evaluate(() => window.__hit)
console.log(`y=400:${h400 >= 0 ? '✓' : '✗'} y=480:${h480 >= 0 ? '✓' : '✗'} y=541:${h541 >= 0 ? '✓' : '✗'}`)
await b.close()
