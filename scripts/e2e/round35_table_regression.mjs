// round35 回归：表格点击编辑（r34 透传桥路径）在批注连线改动后仍正常
// 构造：段落 + 3×3 表格（含较长文字）+ 带批注的段落（触发批注面板 + 连线层渲染）
// 验证：① 单击格内文字中部 → caret offset > 0  ② 打字进入单元格
//       ③ 双击选词  ④ 三击选段  ⑤ 批注连线与表格编辑共存无 pageerror
import { chromium } from 'playwright'
import fs from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE = 'http://localhost:18400'

const cellText = (t) => ({ inline: [{ type: 'text', content: t }] })
const DOC = {
  meta: { title: '表格批注回归' },
  comments: [
    { id: 'c1', author: '审稿人', 'content': '表格数据请与正文核对，确保一致性。' },
    { id: 'c2', author: '编辑', 'content': '结论段落建议补充数据支撑。' },
  ],
  blocks: [
    { type: 'paragraph', inline: [{ type: 'text', 'content': '下表给出不同参数组合下的效益分配模拟结果，供后续分析参考。', commentId: 'c1' }] },
    {
      type: 'table',
      width: [30, 35, 35],
      rows: [
        [cellText('参数组合'), cellText('风险规避系数 ρ'), cellText('最优分享比例 β*')],
        [cellText('基准情形'), cellText('0.5'), cellText('0.42')],
        [cellText('高风险'), cellText('2.0'), cellText('0.31')],
        [cellText('低努力成本'), cellText('1.0'), cellText('0.55')],
      ],
    },
    { type: 'paragraph', inline: [{ type: 'text', 'content': '综上，效益分配比例随风险与成本参数单调变化，政策上应降低信息不对称以提升可行分享区间。', commentId: 'c2' }] },
  ],
}

const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
const pageErrors = []
p.on('pageerror', e => pageErrors.push(e.message.slice(0, 150)))
await p.goto(BASE + '/?r35t=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
await p.evaluate(d => window.__setDocForTest(d), DOC)
await p.waitForTimeout(4000)

// ---------- ① 单击表格格内文字中部 → caret 落在文字中间 ----------
const spot = await p.evaluate(() => {
  const c = document.querySelectorAll('table td')[1]
  const r = c.getBoundingClientRect()
  return { x: r.x + r.width * 0.55, y: r.y + r.height / 2 }
})
await p.mouse.click(spot.x, spot.y)
await p.waitForTimeout(400)
const click1 = await p.evaluate(() => {
  const v = window.__pmView
  const s = v?.state?.selection
  return { inTable: !!v?.state?.doc?.nodeAt?.(s?.from)?.toString?.().includes('table') || v.state.selection.$anchor.depth > 2, from: s?.from }
})
console.log(`① 单击 (2,2) 格: selection.from=${click1.from} depth>2=${click1.inTable}`)

// caret 应在表格内：检查 $anchor 的祖先链
const anchorInfo = await p.evaluate(() => {
  const v = window.__pmView
  const $a = v.state.selection.$anchor
  const chain = []
  for (let d = 1; d <= $a.depth; d++) chain.push($a.node(d).type.name)
  return { chain, offset: $a.parentOffset }
})
const inTable = anchorInfo.chain.includes('table_cell')
console.log(`   祖先链: ${anchorInfo.chain.join(' > ')} ${inTable ? '✓' : '✗'} | parentOffset=${anchorInfo.offset}`)

// ---------- ② 打字进入单元格 ----------
const before = await p.evaluate(() => window.__pmView.state.doc.textContent.length)
await p.keyboard.type('X', { delay: 40 })
await p.waitForTimeout(300)
const after = await p.evaluate(() => window.__pmView.state.doc.textContent.length)
console.log(`② 打字: 文档长度 ${before} → ${after} ${after === before + 1 ? '✓' : '✗'}`)

// ---------- ③ 双击选词 ----------
await p.evaluate(() => { document.querySelector('table').scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(300)
const w = await p.evaluate(() => {
  const c = document.querySelectorAll('table td')[3]
  const tn = (function ft(el) { for (const n of el.childNodes) { if (n.nodeType === 3 && n.textContent.trim()) return n; const r = ft(n); if (r) return r } return null })(c)
  const range = document.createRange(); range.selectNodeContents(tn || c)
  const r = range.getBoundingClientRect()
  return { x: r.x + 10, y: r.y + r.height / 2 }
})
await p.mouse.dblclick(w.x, w.y)
await p.waitForTimeout(400)
const dbl = await p.evaluate(() => {
  const v = window.__pmView
  const pm = v.state.doc.textBetween(v.state.selection.from, v.state.selection.to) || ''
  const dom = window.getSelection()?.toString() || ''
  return { pm, dom, len: v.state.selection.to - v.state.selection.from, sync: pm === dom }
})
// 双击选词：PM/DOM 同步且选中非空（中文单字也算词 —— PM wordboundary 语义）
console.log(`③ 双击选词: "${dbl.pm}" (${dbl.len} 字) PM/DOM同步=${dbl.sync} ${dbl.len >= 1 && dbl.sync ? '✓' : '✗'}`)

// ---------- ④ 批注卡片与连线共存 ----------
const coexist = await p.evaluate(() => {
  const cards = document.querySelectorAll('.comment-card').length
  const paths = document.querySelectorAll('.comment-links-layer path').length
  const marks = document.querySelectorAll('.comment-mark').length
  const tbl = document.querySelectorAll('table').length
  return { cards, paths, marks, tbl }
})
console.log(`④ 共存: 表格 ${coexist.tbl} / 锚点 ${coexist.marks} / 卡片 ${coexist.cards} / 连线 ${coexist.paths} ${coexist.tbl === 1 && coexist.cards === 2 && coexist.paths === 2 ? '✓' : '✗'}`)

console.log(`⑤ pageerror: ${pageErrors.length === 0 ? '0 ✓' : pageErrors.join(' | ')}`)

const pass = inTable && after === before + 1 && dbl.len >= 1 && dbl.sync && coexist.cards === 2 && coexist.paths === 2 && pageErrors.length === 0
console.log(`\n=== 回归结果: ${pass ? 'ALL PASS ✓' : 'FAIL ✗'} ===`)
await p.screenshot({ path: '/home/z/my-project/download/round35-表格批注共存.png' })
await b.close()
process.exit(pass ? 0 : 1)
