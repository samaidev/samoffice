// 进展巨大：Ctrl+A PASS（0-9616 全文档选中）！点击 focus=false 但
// [Content hole not allowed] 报错出现 —— 打开文档时 schema 校验错误，
// 与点击无关（之前就有）。点击 focus=false —— 但拖选测试 cellSel=false。
// 点击编辑与拖选还差：点击后的 focus。可能点击时间太早（分页还在算）。
// 加长等待重测 1) 和 3)：
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const b = await chromium.launch({ args: ['--no-sandbox'], headless: false })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(25000)
const errs = []
p.on('pageerror', e => errs.push(e.message.slice(0, 100)))
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
await p.waitForTimeout(3000)
await p.evaluate(() => {
  const sheet = Array.from(document.styleSheets).find(sh => (sh.href || '').includes('index-'))
  for (let i = sheet.cssRules.length - 1; i >= 0; i--) {
    if ((sheet.cssRules[i].selectorText || '') === '.sam-math') sheet.deleteRule(i)
  }
  sheet.insertRule('.sam-math { display: inline-block; width: 100%; box-sizing: border-box; margin: 8px 0; padding: 4px 8px; background: var(--color-bg-subtle); border: 1px solid var(--color-border); border-radius: 6px; text-align: center; font-family: Cambria Math, Times New Roman, serif }', 0)
})
await p.waitForTimeout(800)
await p.evaluate(() => {
  window.__hit = -1
  window.addEventListener('mousedown', () => { window.__hit = 1 }, true)
  const sc = document.querySelector('.flex-1.overflow-auto')
  const td = document.querySelector('.ProseMirror table td')
  const scRect = sc.getBoundingClientRect()
  const tdTop = td.getBoundingClientRect().top
  sc.scrollTop += tdTop - scRect.top - 300
})
await p.waitForTimeout(3000)  // 充分等待分页稳定

const box = await p.evaluate(() => {
  const td = document.querySelector('.ProseMirror table td')
  const r = td.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(600)
const st = await p.evaluate(() => ({ focused: window.__pmView.hasFocus(), hit: window.__hit, from: window.__pmView.state.selection.from }))
console.log('点击后:', JSON.stringify(st))
if (st.focused) {
  await p.keyboard.type('OK', { delay: 40 })
  await p.waitForTimeout(400)
  const txt = await p.evaluate(() => {
    let t = ''
    window.__pmView.state.doc.descendants(n => { if (!t && n.type.name === 'table_cell') t = n.textContent.slice(0, 10); return !t })
    return t
  })
  console.log('键入 OK →', JSON.stringify(txt), txt.includes('OK') ? 'EDIT-PASS' : 'FAIL')
  await p.keyboard.press('Control+z')
  // 拖选
  const boxes = await p.evaluate(() => {
    const rows = document.querySelectorAll('.ProseMirror table tr')
    const r0 = rows[0].cells[0].getBoundingClientRect()
    const r1 = rows[1].cells[Math.min(1, rows[1].cells.length - 1)].getBoundingClientRect()
    return { from: { x: r0.x + r0.width / 2, y: r0.y + r0.height / 2 }, to: { x: r1.x + r1.width / 2, y: r1.y + r1.height / 2 } }
  })
  await p.mouse.move(boxes.from.x, boxes.from.y)
  await p.mouse.down()
  await p.mouse.move(boxes.to.x, boxes.to.y, { steps: 12 })
  await p.mouse.up()
  await p.waitForTimeout(500)
  const cellSel = await p.evaluate(() => window.__pmView.state.selection.constructor.name)
  await p.keyboard.press('Control+b')
  await p.waitForTimeout(400)
  const bold = await p.evaluate(() => document.querySelectorAll('.ProseMirror table strong').length)
  console.log('拖选类型:', cellSel, '加粗数:', bold, cellSel === 'CellSelection' && bold > 0 ? 'DRAG-PASS' : 'drag-fail')
}
await b.close()
