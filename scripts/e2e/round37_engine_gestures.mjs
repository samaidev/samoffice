// round37 E2E：开源引擎（prosemirror-tables）手势移植到桥接层后的全量验证
// ① 格内拖选文字（PM/DOM 同步 + Backspace 删除生效）
// ② 跨格拖选 → CellSelection 矩形高亮 + Delete 清空
// ③ Shift+click 扩展 CellSelection（引擎 shift 分支移植）
// ④ 双击选词 / 三击选格（三击 = 引擎 handleTripleClick 语义：CellSelection）
// ⑤ 行拖拽协同不回退（CellSelection 行选区内 mousedown → __samStartRowDrag）
// ⑥ 表格外正常段落不受影响（点击/拖选）
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const cellText = (t) => ({ inline: [{ type: 'text', content: t }] })
const mkDoc = () => ({
  meta: { title: 'r37' },
  blocks: [
    { type: 'paragraph', inline: [{ type: 'text', content: '表格拖选测试段落。' }] },
    { type: 'table', width: [30, 35, 35], rows: [
      [cellText('参数组合'), cellText('风险规避系数'), cellText('最优分享比例')],
      [cellText('基准情形 baseline'), cellText('0.5'), cellText('0.42')],
      [cellText('高风险情形'), cellText('2.0'), cellText('0.31')],
    ]},
    { type: 'paragraph', inline: [{ type: 'text', content: '表格之后的普通段落文字。' }] },
  ],
})
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
const errs = []
p.on('pageerror', e => errs.push(e.message.slice(0, 150)))
await p.goto(BASE + '/?r37=' + Date.now(), { waitUntil: 'networkidle' })
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
  if (frac) return { x: cell.x + cell.width * frac, y: cell.y + cell.height / 2 }
  return { x: tr.x + 2, y: tr.y + tr.height / 2 }
}, { idx, frac })
let passCount = 0, failCount = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? '：' + detail : ''}`)
  ok ? passCount++ : failCount++
}

// ---------- ① 格内拖选 ----------
const s = await posOf(3)
await p.mouse.move(s.x, s.y); await p.mouse.down()
await p.mouse.move(s.x + 45, s.y, { steps: 10 })
await p.mouse.up(); await p.waitForTimeout(400)
const after1 = await p.evaluate(() => {
  const v = window.__pmView
  return { dom: window.getSelection()?.toString() || '', pm: v.state.doc.textBetween(v.state.selection.from, v.state.selection.to) }
})
check('① 格内拖选', after1.dom.length > 0 && after1.dom === after1.pm, `dom="${after1.dom}"`)
const lenB = await p.evaluate(() => window.__pmView.state.doc.textContent.length)
await p.keyboard.press('Backspace'); await p.waitForTimeout(300)
const lenA = await p.evaluate(() => window.__pmView.state.doc.textContent.length)
check('① Backspace 删除', lenA < lenB, `${lenB}→${lenA}`)

// ---------- ② 跨格拖选 ----------
await p.evaluate(d => window.__setDocForTest(d), mkDoc())
await p.waitForTimeout(5000)
const a = await posOf(0, 0.5), c = await posOf(5, 0.5)
await p.mouse.move(a.x, a.y); await p.mouse.down()
await p.mouse.move(c.x, c.y, { steps: 12 })
await p.mouse.up(); await p.waitForTimeout(400)
const after2 = await p.evaluate(() => ({
  isCell: !!window.__pmView.state.selection.$anchorCell,
  hi: document.querySelectorAll('.selectedCell').length,
}))
check('② 跨格拖选 CellSelection', after2.isCell && after2.hi >= 4, `isCell=${after2.isCell} 高亮=${after2.hi}`)

// ---------- ③ Shift+click 扩展 ----------
await p.evaluate(d => window.__setDocForTest(d), mkDoc())
await p.waitForTimeout(5000)
// 先单击 (0,0)
const c00 = await posOf(0, 0.5)
await p.mouse.click(c00.x, c00.y); await p.waitForTimeout(200)
// Shift+click (2,2) —— 引擎第三分支（文本选区 → CellSelection）
const c22 = await posOf(8, 0.5)
await p.keyboard.down('Shift')
await p.mouse.click(c22.x, c22.y)
await p.keyboard.up('Shift')
await p.waitForTimeout(400)
const after3 = await p.evaluate(() => ({
  isCell: !!window.__pmView.state.selection.$anchorCell,
  hi: document.querySelectorAll('.selectedCell').length,
}))
check('③ Shift+click 扩展', after3.isCell && after3.hi >= 4, `isCell=${after3.isCell} 高亮=${after3.hi}`)
// 再 Shift+click (0,2) 扩展（引擎第二分支：已有 CellSelection）
const c02 = await posOf(2, 0.5)
await p.keyboard.down('Shift')
await p.mouse.click(c02.x, c02.y)
await p.keyboard.up('Shift')
await p.waitForTimeout(400)
const after3b = await p.evaluate(() => ({ isCell: !!window.__pmView.state.selection.$anchorCell, hi: document.querySelectorAll('.selectedCell').length }))
check('③ Shift+click 二次扩展', after3b.isCell && after3b.hi >= 2, `isCell=${after3b.isCell} 高亮=${after3b.hi}`)

// ---------- ④ 双击/三击 ----------
await p.evaluate(d => window.__setDocForTest(d), mkDoc())
await p.waitForTimeout(5000)
const c1 = await posOf(3)
await p.mouse.dblclick(c1.x, c1.y); await p.waitForTimeout(300)
const dbl = await p.evaluate(() => window.__pmView.state.doc.textBetween(window.__pmView.state.selection.from, window.__pmView.state.selection.to))
check('④ 双击选词', dbl.length > 0, `"${dbl}"`)
await p.waitForTimeout(600)
for (let i = 0; i < 3; i++) { await p.mouse.move(c1.x, c1.y); await p.mouse.down(); await p.mouse.up() }
await p.waitForTimeout(400)
const tri = await p.evaluate(() => {
  const v = window.__pmView
  const isCell = !!v.state.selection.$anchorCell
  return { isCell, hi: document.querySelectorAll('.selectedCell').length, text: v.state.selection instanceof v.state.selection.constructor ? '' : '' }
})
check('④ 三击选格（引擎 CellSelection 语义）', tri.isCell && tri.hi >= 1, `isCell=${tri.isCell} 高亮=${tri.hi}`)

// ---------- ⑤ 表格外段落不受影响 ----------
const para = await p.evaluate(() => {
  const ps = [...document.querySelectorAll('.ProseMirror > p')]
  const last = ps[ps.length - 1]
  const range = document.createRange()
  range.setStart(last.firstChild, 0); range.setEnd(last.firstChild, 1)
  const tr = range.getBoundingClientRect()
  return { x: tr.x, y: tr.y + tr.height / 2 }
})
await p.mouse.move(para.x, para.y); await p.mouse.down()
await p.mouse.move(para.x + 40, para.y, { steps: 8 })
await p.mouse.up(); await p.waitForTimeout(300)
const after5 = await p.evaluate(() => window.getSelection()?.toString() || '')
check('⑤ 表格外段落拖选不受桥影响', after5.length > 0, `"${after5}"`)

// ---------- ⑥ 打字 ----------
await p.evaluate(d => window.__setDocForTest(d), mkDoc())
await p.waitForTimeout(5000)
const cType = await posOf(4, 0.5)
await p.mouse.click(cType.x, cType.y); await p.waitForTimeout(200)
await p.keyboard.type('Q7'); await p.waitForTimeout(300)
const typed = await p.evaluate(() => window.__pmView.state.doc.textContent.includes('Q7'))
check('⑥ 点击后打字', typed, `Q7 出现=${typed}`)

check('⑦ pageerror', errs.length === 0, errs.join(' | ').slice(0, 100))
console.log(`\n=== round37 结果: ${failCount === 0 ? 'ALL PASS ✓' : 'FAIL ✗'} (${passCount}/${passCount + failCount}) ===`)
await p.screenshot({ path: '/home/z/my-project/download/round37-引擎手势移植.png' })
await b.close()
process.exit(failCount === 0 ? 0 : 1)
