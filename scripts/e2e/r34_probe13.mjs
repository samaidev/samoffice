import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
await p.goto(BASE + '/?r=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(2500)
// 新建空文档（不经上传）：直接插入表格
await p.evaluate(() => { window.__setDocForTest?.({ id: 't', name: 'new', type: 'word', blocks: [{ type: 'paragraph', runs: [{ text: 'hello' }] }], createdAt: '', updatedAt: '' }) })
await p.waitForTimeout(2500)
await p.evaluate(() => {
  window.__n = 0
  document.addEventListener('mousedown', () => window.__n++, true)
})
// 找插入表格按钮？不确定 UI。更可靠：用 PM view 直接 dispatch 插入表格
const ok = await p.evaluate(() => {
  const view = window.__pmView
  if (!view) return 'no view'
  // schema 里有 table 节点 —— 构造 3x3
  const s = view.state.schema
  const mkCell = () => s.nodes.table_cell.createAndFill({}, s.nodes.paragraph.create())
  const mkRow = () => s.nodes.table_row.createAndFill({}, [mkCell(), mkCell(), mkCell()])
  const tbl = s.nodes.table.createAndFill({}, [mkRow(), mkRow(), mkRow()])
  if (!tbl) return 'schema no table: ' + Object.keys(s.nodes).join(',')
  view.dispatch(view.state.tr.replaceSelectionWith(tbl))
  return 'inserted'
})
console.log('插入表格:', ok)
await p.waitForTimeout(1000)
const box = await p.evaluate(() => {
  const c = document.querySelector('table td')
  if (!c) return null
  const r = c.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
if (box) {
  const before = await p.evaluate(() => window.__n)
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(300)
  const after = await p.evaluate(() => window.__n)
  const sel = await p.evaluate(() => {
    const td = window.getSelection()?.focusNode?.parentElement?.closest('td')
    return td ? 'cell:' + td.textContent.slice(0, 8) : '【无】'
  })
  console.log('新表格点击:', after > before ? '✓ 收到' : '✗ 丢失', '| selection:', sel)
} else {
  console.log('未找到新表格')
}
await b.close()
