// 代码与重放一致：pos=21 → cellStart=23 → target=24 → near(24,1)。
// 但 dispatch 收到 SEL:52。唯一解释：near($pos.resolve(24), 1) 返回 52？！
// near 的行为：找 $pos 附近【valid text position】。resolve(24) 在
// table 内 cell 开头 —— 但如果 schema 的 table_cell content 是
// 'block+'（不是 inline），cell 内容开头不在 24 —— near 向外找最近的
// text position —— 可能跳到表格【后面】的段落（51+1=52）！
// ★★★ 这就是 52 的来源：near() 向后跳出了 cell！
// 为什么 r26_last.mjs 成功（"Q5A1"）？那次用的 target=tablePos+3 是
// 【cell 的 doc 位置】且 near() 恰好往【cell 内的 p】落位成功——不，
// 一样是 near。差异：r26_last 是无偏（near($pos)）—— 但那次 from=25
// —— 等下 r26_last 输出 from=25（手动设 target=tablePos+3=24? pos=21
// → 24，from=25 —— near 给了 25 = cell0 的 p 内 position！）
// 而 v.dispatch 版本 SEL:52 —— bias=1 的 near 跳出了？bias 方向反了！
// near($pos, bias) bias>1 偏后。r26_last 无 bias（默认1）—— 一样……
// ◆ 不猜了：页面里直接测三种调用：
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
const res = await p.evaluate(() => {
  const v = window.__pmView
  const S = v.state.selection.constructor
  const out = {}
  for (const t of [23, 24, 25, 26]) {
    try { out['near(' + t + ',1)'] = S.near(v.state.doc.resolve(t), 1).from } catch (e) { out['near(' + t + ',1)'] = 'ERR' }
    try { out['near(' + t + ')'] = S.near(v.state.doc.resolve(t)).from } catch (e) { out['near(' + t + ')'] = 'ERR' }
  }
  // cell0 的正确光标位：table(21) > row(22) > cell(23) > p(24) > 文本(25..)
  out.resolve24 = v.state.doc.resolve(24).parent.type.name
  out.resolve25 = v.state.doc.resolve(25).parent.type.name
  return out
})
console.log(JSON.stringify(res, null, 1))
await b.close()
