// round36 验证：表格内拖拽多选文字 + 跨格拖选（用户报告两项都失效）
// ① 格内拖选：mousedown→move→mouseup，期间与松开后 PM/DOM 选区一致且非空
// ② 拖选后打 Backspace：删除的是选中文字（选区真实生效）
// ③ 跨格拖选：从 A 格拖到 B 格 → CellSelection（isCell=true），视觉高亮存在
// ④ 跨格 CellSelection 后按删除：清空所选格内容（Word 行为）
// ⑤ 悬停无污染：松开后纯移动鼠标，选区不变
// ⑥ 单击/双击/三击回归（r34 行为不回退）
import { chromium } from 'playwright'
const BASE = 'http://127.0.0.1:18400'
const cellText = (t) => ({ inline: [{ type: 'text', content: t }] })
const mkDoc = () => ({
  meta: { title: 'r36' },
  blocks: [
    { type: 'paragraph', inline: [{ type: 'text', content: '表格拖选测试段落。' }] },
    { type: 'table', width: [30, 35, 35], rows: [
      [cellText('参数组合'), cellText('风险规避系数'), cellText('最优分享比例')],
      [cellText('基准情形 baseline'), cellText('0.5'), cellText('0.42')],
      [cellText('高风险情形'), cellText('2.0'), cellText('0.31')],
    ]},
  ],
})
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
const pageErrors = []
p.on('pageerror', e => pageErrors.push(e.message.slice(0, 150)))
await p.goto(BASE + '/?r36=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
await p.evaluate(d => window.__setDocForTest(d), mkDoc())
await p.waitForTimeout(5000)

const posOf = (idx, frac = 0) => p.evaluate(({ idx, frac }) => {
  const c = document.querySelectorAll('table td')[idx]
  const range = document.createRange()
  const tn = c.querySelector('p')?.firstChild || c.firstChild
  range.setStart(tn, 0); range.setEnd(tn, 1)
  const tr = range.getBoundingClientRect()
  const cell = c.getBoundingClientRect()
  // frac=0 取文字起点，否则取格子中心
  if (frac) return { x: cell.x + cell.width * frac, y: cell.y + cell.height / 2 }
  return { x: tr.x + 2, y: tr.y + tr.height / 2 }
}, { idx, frac })

// ---------- ① 格内拖选 ----------
const s = await posOf(3) // (1,0) "基准情形 baseline" 文字起点
await p.mouse.move(s.x, s.y)
await p.mouse.down()
await p.mouse.move(s.x + 45, s.y, { steps: 10 })
await p.waitForTimeout(250)
const during = await p.evaluate(() => {
  const v = window.__pmView
  return { domSel: window.getSelection()?.toString() || '', pmText: v.state.doc.textBetween(v.state.selection.from, v.state.selection.to), pmType: v.state.selection.constructor.name }
})
await p.mouse.up()
await p.waitForTimeout(500)
const after = await p.evaluate(() => {
  const v = window.__pmView
  return { domSel: window.getSelection()?.toString() || '', pmText: v.state.doc.textBetween(v.state.selection.from, v.state.selection.to), pmType: v.state.selection.constructor.name }
})
console.log(`① 格内拖选: 拖拽中 dom="${during.domSel}" pm="${during.pmText}" | 松开后 dom="${after.domSel}" pm="${after.pmText}"`)
const pass1 = during.domSel.length > 0 && after.domSel.length > 0 && after.domSel === after.pmText

// ---------- ② 拖选后 Backspace 删除选中文字 ----------
if (pass1) {
  const lenBefore = await p.evaluate(() => window.__pmView.state.doc.textContent.length)
  await p.keyboard.press('Backspace')
  await p.waitForTimeout(400)
  const lenAfter = await p.evaluate(() => window.__pmView.state.doc.textContent.length)
  const removed = await p.evaluate(() => !window.__pmView.state.doc.textContent.includes('基准情形'))
  console.log(`② Backspace: 文档长度 ${lenBefore} → ${lenAfter}，"基准情形"已删=${removed} ${lenAfter < lenBefore && removed ? '✓' : '✗'}`)
}

// ---------- ③ 跨格拖选（重新注入文档） ----------
await p.evaluate(d => window.__setDocForTest(d), mkDoc())
await p.waitForTimeout(5000)
const a = await posOf(0, 0.5)  // (0,0) 格中心
const c = await posOf(5, 0.5)  // (1,2) 格中心
await p.mouse.move(a.x, a.y)
await p.mouse.down()
await p.mouse.move(c.x, c.y, { steps: 12 })
await p.waitForTimeout(300)
const crossDuring = await p.evaluate(() => {
  const v = window.__pmView
  return { isCell: !!v.state.selection.$anchorCell, pmType: v.state.selection.constructor.name }
})
await p.mouse.up()
await p.waitForTimeout(500)
const crossAfter = await p.evaluate(() => {
  const v = window.__pmView
  // CellSelection 覆盖的单元格数（视觉高亮 = .selectedCell 类）
  const sel = v.state.selection
  const cells = sel.$anchorCell && sel.$headCell ? (() => {
    let n = 0
    // 数 DOM 高亮
    n = document.querySelectorAll('.selectedCell').length
    return n
  })() : 0
  return { isCell: !!sel.$anchorCell, domSel: (window.getSelection()?.toString() || '').slice(0, 25), highlightedCells: cells }
})
console.log(`③ 跨格拖选: 拖拽中 isCell=${crossDuring.isCell}(${crossDuring.pmType}) | 松开后 isCell=${crossAfter.isCell} 高亮格数=${crossAfter.highlightedCells}`)
const pass3 = crossDuring.isCell && crossAfter.isCell && crossAfter.highlightedCells >= 4

// ---------- ④ CellSelection 后删除：清空所选格 ----------
if (pass3) {
  const lenBefore = await p.evaluate(() => window.__pmView.state.doc.textContent.length)
  await p.keyboard.press('Backspace')
  await p.waitForTimeout(400)
  const afterDel = await p.evaluate(() => {
    const t = window.__pmView.state.doc.textContent
    return { hasParam: t.includes('参数组合'), hasShare: t.includes('最优分享比例'), hasBase: t.includes('基准情形'), has042: t.includes('0.42') }
  })
  console.log(`④ 跨格删除: 内容残存 ${JSON.stringify(afterDel)}（所选 6 格应被清空） ${!afterDel.hasParam && !afterDel.hasBase && !afterDel.has042 ? '✓' : '✗'}`)
}

// ---------- ⑤ 悬停无污染 ----------
const selBefore = await p.evaluate(() => (window.getSelection()?.toString() || '').length)
await p.mouse.move(a.x + 60, a.y + 40, { steps: 6 })
await p.waitForTimeout(500)
const selAfterHover = await p.evaluate(() => (window.getSelection()?.toString() || '').length)
console.log(`⑤ 悬停无污染: 选区长度 ${selBefore} → ${selAfterHover} ${selBefore === selAfterHover ? '✓' : '✗'}`)
const pass5 = selBefore === selAfterHover

// ---------- ⑥ 单击/双击/三击回归 ----------
await p.evaluate(d => window.__setDocForTest(d), mkDoc())
await p.waitForTimeout(5000)
// 单击
const c1 = await posOf(3, 0.5)
await p.mouse.click(c1.x, c1.y)
await p.waitForTimeout(300)
const click1 = await p.evaluate(() => {
  const $a = window.__pmView.state.selection.$anchor
  const chain = []
  for (let d = 1; d <= $a.depth; d++) chain.push($a.node(d).type.name)
  return { chain: chain.join('>'), offset: $a.parentOffset }
})
// 双击
await p.mouse.dblclick(c1.x, c1.y)
await p.waitForTimeout(400)
const dbl = await p.evaluate(() => {
  const v = window.__pmView
  return { text: v.state.doc.textBetween(v.state.selection.from, v.state.selection.to), dom: window.getSelection()?.toString() || '' }
})
// 三击（与双击间隔 >500ms，脱离连击计数窗口 —— 对齐真实用户节奏）
await p.waitForTimeout(600)
for (let i = 0; i < 3; i++) { await p.mouse.move(c1.x, c1.y); await p.mouse.down(); await p.mouse.up() }
await p.waitForTimeout(400)
const tri = await p.evaluate(() => {
  const v = window.__pmView
  return { text: v.state.doc.textBetween(v.state.selection.from, v.state.selection.to) }
})
console.log(`⑥ 回归: 单击链=${click1.chain} offset=${click1.offset} | 双击 "${dbl.text}"(dom同步=${dbl.text === dbl.dom}) | 三击 "${tri.text}"`)
const pass6 = click1.chain.includes('table_cell') && dbl.text === dbl.dom && tri.text.includes('基准')

console.log(`⑦ pageerror: ${pageErrors.length === 0 ? '0 ✓' : pageErrors.join(' | ')}`)

const pass = pass1 && pass3 && pass5 && pass6 && pageErrors.length === 0
console.log(`\n=== round36 结果: ${pass ? 'ALL PASS ✓' : 'FAIL ✗'} ===`)
await p.screenshot({ path: '/home/z/my-project/download/round36-跨格拖选.png' })
await b.close()
process.exit(pass ? 0 : 1)
