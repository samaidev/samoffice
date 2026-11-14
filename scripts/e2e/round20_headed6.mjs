// headed5 全失败但 headed2 成功 —— headed2 与 headed5 的唯一区别：
// headed2 先点了 (309,400) 和 (309,480) 两个【活区】点！
// 推论：第一次点击【某个活区】后才激活整个输入管线？！
// 或者…… headed2 点击的 480 是表格【上方段落】，点击后 PM focus 了，
// 后续 541 的点击才正常路由！
// 这在真实用户场景 = "先点正文再点表格可以，直接点表格不行" —— 严重 bug！
// A/B 验证：点正文段落 → focus → 再点表格
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
await p.waitForTimeout(2500)
const pts = await p.evaluate(() => {
  const td = document.querySelector('.ProseMirror table td')
  const r = td.getBoundingClientRect()
  // 表格上方的段落（视口内表格之前的内容）
  const before = document.elementFromPoint(r.x, r.top - 60)
  return {
    cell: { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) },
    beforeTag: before?.tagName || 'null',
    beforePt: { x: Math.round(r.x + 30), y: Math.round(r.top - 60) },
  }
})
console.log('点位:', JSON.stringify(pts))
// 点击表格上方内容（若不是 P 就点空白 y-100）
await p.mouse.click(pts.beforePt.x, pts.beforePt.y)
await p.waitForTimeout(500)
const f1 = await p.evaluate(() => window.__pmView.hasFocus())
console.log('点上方(' + pts.beforeTag + ')后 focus:', f1)
// 现在点表格
await p.mouse.click(pts.cell.x, pts.cell.y)
await p.waitForTimeout(400)
const f2 = await p.evaluate(() => window.__pmView.hasFocus())
await p.keyboard.type('Q', { delay: 40 })
await p.waitForTimeout(300)
const txt = await p.evaluate(() => {
  let t = ''
  window.__pmView.state.doc.descendants(n => { if (!t && n.type.name === 'table_cell') t = n.textContent.slice(0, 10); return !t })
  return t
})
console.log('再点表格 focus:', f2, '文本:', JSON.stringify(txt), txt.includes('Q') ? 'PASS' : 'FAIL')
await b.close()
