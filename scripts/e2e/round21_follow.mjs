import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const b = await chromium.launch({ args: ['--no-sandbox'], headless: true })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(20000)
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

// 场景：在第一段构造 [普通文本][粗体文本] 光标在粗体后输入
await p.evaluate(() => {
  const pm = window.__pmView
  // 第一个文本节点 1..16 'mojoz@139.co'
  const bold = pm.state.schema.marks.bold
  pm.dispatch(pm.state.tr.addMark(1, 6, bold.create()))
})
await p.waitForTimeout(200)
// 光标放在粗体末尾（pos 6）
await p.evaluate(() => {
  const pm = window.__pmView
  const TextSel = pm.state.selection.constructor
  pm.dispatch(pm.state.tr.setSelection(TextSel.create(pm.state.doc, 6)))
  pm.focus()
})
await p.waitForTimeout(300)
await p.keyboard.type('X', { delay: 30 })
await p.waitForTimeout(400)
const r1 = await p.evaluate(() => {
  const pm = window.__pmView
  const node = pm.state.doc.nodeAt(6)
  return { text: node?.text?.slice(0, 8), marks: (node?.marks || []).map(m => m.type.name) }
})
console.log('粗体末尾输入 X →', JSON.stringify(r1))
// 对照：光标放在普通文本末尾（16）
await p.evaluate(() => {
  const pm = window.__pmView
  const TextSel = pm.state.selection.constructor
  pm.dispatch(pm.state.tr.setSelection(TextSel.create(pm.state.doc, 17)))
  pm.focus()
})
await p.waitForTimeout(200)
await p.keyboard.type('Y', { delay: 30 })
await p.waitForTimeout(400)
const r2 = await p.evaluate(() => {
  const pm = window.__pmView
  const node = pm.state.doc.nodeAt(17)
  return { text: node?.text?.slice(0, 8), marks: (node?.marks || []).map(m => m.type.name) }
})
console.log('普通文本末尾输入 Y →', JSON.stringify(r2))
await b.close()
