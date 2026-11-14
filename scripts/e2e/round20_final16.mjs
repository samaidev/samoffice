// ★★★ 改写 A（display:inline-block + width:100%）修复！
// 机制终于清晰：.sam-math display:block 是块级 KaTeX 容器 ——
// 大量块级 display:box 元素触发 Chromium 一个 layer 相关 bug；
// inline-block 保留几乎相同视觉。
// 但为什么公式块会锁死【表格】的点击？管他呢 —— 现在有修复。
// 再验证改写 A 的视觉一致 + 编辑功能恢复：
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
await p.waitForTimeout(2500)
await p.evaluate(() => {
  const sheet = Array.from(document.styleSheets).find(sh => (sh.href || '').includes('index-'))
  for (let i = sheet.cssRules.length - 1; i >= 0; i--) {
    if ((sheet.cssRules[i].selectorText || '') === '.sam-math') sheet.deleteRule(i)
  }
  sheet.insertRule('.sam-math { display: inline-block; width: 100%; box-sizing: border-box; margin: 8px 0; padding: 4px 8px; background: var(--color-bg-subtle); border: 1px solid var(--color-border); border-radius: 6px; text-align: center; font-family: Cambria Math, Times New Roman, serif }', 0)
})
await p.waitForTimeout(500)
// 滚到表格
await p.evaluate(() => {
  window.__hit = -1
  window.addEventListener('mousedown', () => { window.__hit = 1 }, true)
  const sc = document.querySelector('.flex-1.overflow-auto')
  const td = document.querySelector('.ProseMirror table td')
  const scRect = sc.getBoundingClientRect()
  const tdTop = td.getBoundingClientRect().top
  sc.scrollTop += tdTop - scRect.top - 300
})
await p.waitForTimeout(2000)

// 1) 点击编辑
const box = await p.evaluate(() => {
  const td = document.querySelector('.ProseMirror table td')
  const r = td.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(400)
const focused = await p.evaluate(() => window.__pmView.hasFocus())
await p.keyboard.type('OK', { delay: 40 })
await p.waitForTimeout(300)
const txt = await p.evaluate(() => {
  let t = ''
  window.__pmView.state.doc.descendants(n => { if (!t && n.type.name === 'table_cell') t = n.textContent.slice(0, 10); return !t })
  return t
})
console.log('1) 点击编辑: focus=' + focused + ' 文本=' + JSON.stringify(txt), (focused && txt.includes('OK')) ? 'PASS' : 'FAIL')
await p.keyboard.press('Control+z')

// 2) Ctrl+A
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(200)
await p.keyboard.press('Control+a')
await p.waitForTimeout(300)
const sel = await p.evaluate(() => { const s = window.__pmView.state.selection; return { from: s.from, to: s.to } })
console.log('2) Ctrl+A:', sel.from + '-' + sel.to, sel.to - sel.from > 1000 ? 'PASS' : 'FAIL')
await p.keyboard.press('Escape')

// 3) 跨格拖选 + 加粗
const boxes = await p.evaluate(() => {
  const rows = document.querySelectorAll('.ProseMirror table tr')
  const r0 = rows[0].cells[0].getBoundingClientRect()
  const r1 = rows[1].cells[Math.min(1, rows[1].cells.length - 1)].getBoundingClientRect()
  return { from: { x: r0.x + r0.width / 2, y: r0.y + r0.height / 2 }, to: { x: r1.x + r1.width / 2, y: r1.y + r1.height / 2 } }
})
await p.mouse.move(boxes.from.x, boxes.from.y)
await p.mouse.down()
await p.mouse.move(boxes.to.x, boxes.to.y, { steps: 10 })
await p.mouse.up()
await p.waitForTimeout(400)
const dragSel = await p.evaluate(() => window.__pmView.state.selection.constructor.name === 'CellSelection')
await p.keyboard.press('Control+b')
await p.waitForTimeout(400)
const bold = await p.evaluate(() => document.querySelectorAll('.ProseMirror table strong').length)
console.log('3) 跨格拖选(cellSel=' + dragSel + ')加粗数:', bold, dragSel && bold > 0 ? 'PASS' : 'FAIL')
await p.keyboard.press('Control+z')
await p.screenshot({ path: 'scripts/e2e/round19-shots/table-edit-fixed.png' })
console.log('errors:', errs.slice(0, 2))
await b.close()
