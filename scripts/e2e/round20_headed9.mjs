// 确凿：同会话内 段落✓ 表格✗ 段落✓ —— 只有【表格区域】吞 mousedown。
// DOM hit-test 正常（SPAN inTD）—— 那 chromium 事件派发为什么跳过？
// 等等……有一个从未检查的：表格区域是不是处于【contenteditable 的安全沙箱】——
// td 里 SPAN 的 contenteditable 继承状态！若 td 意外 contenteditable=false，
// Chromium 会把该区域视为不可编辑 —— 但事件仍应派发（不会吞）。
// 检查：td 及其子孙的 contenteditable 计算值：
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
const info = await p.evaluate(() => {
  const td = document.querySelector('.ProseMirror table td')
  const rows = []
  let n = td
  while (n && rows.length < 8) {
    const s = getComputedStyle(n)
    rows.push(`${n.tagName}.${(n.className?.toString().slice(0, 15) || '')} ce=${n.getAttribute('contenteditable') || (s.webkitUserModify || '-')} us=${s.userSelect}`)
    n = n.parentElement
  }
  // user-select:none 会吞事件吗？不会吞 mousedown，但会阻止选择。
  // 关键新嫌疑：user-select:none + draggable？
  const table = document.querySelector('.ProseMirror table')
  return { chain: rows, tableDrag: table.getAttribute('draggable'), tableUS: getComputedStyle(table).userSelect }
})
console.log(JSON.stringify(info, null, 1))
await b.close()
