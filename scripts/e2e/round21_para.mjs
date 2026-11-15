// 段落样式继承测试：回车后新段落是否继承对齐/样式/字号
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

// 找一个段落，设置居中对齐 + 标题样式，光标到段末按回车
const prep = await p.evaluate(() => {
  const pm = window.__pmView
  const doc = pm.state.doc
  // 找第一个段落（含文本）
  let pos = -1, end = -1, size = 0
  doc.descendants((node, p2) => {
    if (pos < 0 && node.type.name === 'paragraph' && node.textContent.trim().length > 4) { pos = p2; end = p2 + node.nodeSize; size = node.nodeSize }
    return pos < 0
  })
  if (pos < 0) return { ok: false }
  // 设居中
  pm.dispatch(pm.state.tr.setNodeMarkup(pos, undefined, { ...(doc.nodeAt(pos)?.attrs || {}), align: 'center' }))
  const TextSel = pm.state.selection.constructor
  pm.dispatch(pm.state.tr.setSelection(TextSel.create(pm.state.doc, end - 1)))
  pm.focus()
  const before = pm.state.doc.nodeAt(pos)?.attrs
  return { ok: true, pos, nextPos: pos + size, before: { align: before?.align, style: before?.style } }
})
console.log('段落准备:', JSON.stringify(prep))
await p.keyboard.press('Enter')
await p.waitForTimeout(500)
const after = await p.evaluate(pp => {
  const pm = window.__pmView
  const node = pm.state.doc.nodeAt(pp.nextPos) // 原段落之后的第一个块
  return { type: node?.type.name, attrs: node?.attrs }
}, prep)
console.log('回车后新段落:', JSON.stringify(after))
console.log(after?.attrs?.align === 'center' ? 'PASS 段落样式继承' : 'FAIL 段落样式丢失')
await b.close()
