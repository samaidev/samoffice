// round33 E2E：Word 表格点击光标复现
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 200)))
p.on('console', m => { if (m.type() === 'error') console.log('CERR:', m.text().slice(0, 200)) })
p.setDefaultTimeout(30000)
await p.goto(BASE + '/?r=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(2500)
await p.evaluate(async () => {
  const r = await fetch('/upload-test.docx')
  const buf = await r.arrayBuffer()
  const file = new File([buf], 'upload-test.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
  const dt = new DataTransfer()
  dt.items.add(file)
  document.querySelector('#root > div').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
})
await p.waitForTimeout(9000)

const info = await p.evaluate(() => {
  const tables = document.querySelectorAll('table')
  return { tableCount: tables.length, rows: tables[0]?.rows.length, cells: tables[0]?.rows[0]?.cells.length }
})
console.log('表格状态:', JSON.stringify(info))

// 点击第一个表格各单元格，检查光标
const results = []
const cells = await p.$$('table td, table th')
console.log('可点单元格数:', cells.length)
// 点击第 1、2、5、10 个单元格测试
for (const idx of [0, 1, 4, 9, 15]) {
  if (idx >= cells.length) continue
  const cell = cells[idx]
  const box = await cell.boundingBox()
  if (!box) { results.push({ idx, err: 'no box' }); continue }
  await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await p.waitForTimeout(500)
  const st = await p.evaluate(() => {
    const sel = window.getSelection()
    const focusNode = sel?.focusNode
    // ProseMirror 光标：caret in text?
    const caretVisible = !!document.querySelector('.ProseMirror-selectednode, .pm-table-cell-selected, [class*=caret]')
    // PM 编辑器获得焦点？
    const pmFocused = !!document.querySelector('.ProseMirror-focused')
    const selText = sel ? (sel.focusNode?.textContent || '').slice(0, 20) : ''
    return { isCollapsed: sel?.isCollapsed, focusTag: focusNode?.nodeName, selText, pmFocused, rangeCount: sel?.rangeCount }
  })
  results.push({ idx, text: (await cell.textContent()).slice(0, 12), ...st })
}
console.log(JSON.stringify(results, null, 1))
await p.screenshot({ path: '/tmp/r33_table.png' })
await b.close()
console.log('DONE')
