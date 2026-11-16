// dispatch 记录 SEL:52 —— 我们的 handler 【跑了】且 dispatch(from=52)！
// 但 SEL:52 ≠ 我们算的 target=3 → near(3,1)。52 从哪来？
// near($pos=3, bias=1) 应给 3/4/5 …… 除非 —— tr.setSelection 的
// selection 是【CellSelection】？不 —— near 构造 TextSelection。
// ★ 除非 resolve(3) 不是 cell 内容开头！cellStart = pos+1+row.off+1+cell.off
// pos = wrapper 对应 table 节点位置 —— v.nodeDOM(off) === wrapper？
// ★★★ 找到 bug 了！！v.nodeDOM(off) 对 table 节点返回的是
// 【NodeView 的 dom】= wrapper ✓。但 pos 遍历用 found<0 —— 第一个
// table —— 对。row.off=0, cell.off=0 → cellStart = pos+2。
// 若 pos=1（table 是 doc 第2个节点? doc=[p, table, p] → table pos=3!
//（p 占 0-2）—— cellStart=3+2=5? target=6? near(6)=6? 但 SEL:52！
// 52 ≈ 表格后 p 的位置（table 3..49?）—— 从 52 反推：cellStart+1 附近
// 根本不是 52。
// ◆ 唯一能让 near 给 52 的 —— resolve(52) —— target=52？！
// 即 cellStart+1=52 —— cellStart=51 —— pos+3=51 —— pos=48？
// pos=48 不可能是 table 的位置（table 在 3）。
// ★★ 除非 forEach 的 found 匹配了【错的 nodeDOM】：v.nodeDOM(3) 返回
// 的 wrapper 是【另一个 wrapper】（旧 NodeView 的孤儿 dom？）—— 
// d === wrapper 判定失败 → found 停在 -1 → 走 v.focus() return？—— 
// 但 dispatch 跑了 SEL:52 —— 说明代码到了 dispatch —— target=52。
// ◆◆ 直接在页面重放位置算法看 pos 值：
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 150)))
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
await p.evaluate(() => window.__setDocForTest({ meta: { title: 't' }, blocks: [
  { type: 'p', inline: [{ content: '段落内容一' }] },
  { type: 'table', rows: [
    [{ inline: [{ content: 'A1' }] }, { inline: [{ content: 'B1' }] }],
    [{ inline: [{ content: 'A2' }] }, { inline: [{ content: 'B2' }] }],
  ] },
] }))
await p.waitForTimeout(2500)
const pb = await p.evaluate(() => { const r = document.querySelector('.ProseMirror p').getBoundingClientRect(); return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.5 } })
await p.mouse.click(pb.x, pb.y)
await p.waitForTimeout(600)
const info = await p.evaluate(() => {
  const v = window.__pmView
  const pm = v.dom
  const wrapper = pm.querySelector('.tableWrapper')
  // 重放管理器的 pos 查找
  let found = -1
  const dbg = []
  v.state.doc.forEach((n, off) => {
    if (n.type.name === 'table') {
      const d = v.nodeDOM(off)
      dbg.push(off + ':' + (d ? (d === wrapper ? 'MATCH' : (d.contains ? 'other:' + (d.contains(wrapper) ? 'contains' : 'diff') : '?')) : 'null'))
      if (found < 0 && d && (d === wrapper || (d.contains && d.contains(wrapper)))) found = off
    }
  })
  return { found, dbg, docTop: (() => { const a = []; v.state.doc.forEach((n, off) => a.push(off + ':' + n.type.name + '/' + n.nodeSize)); return a })() }
})
console.log(JSON.stringify(info, null, 1))
await b.close()
