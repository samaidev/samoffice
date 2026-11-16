// from 在 16ms 变为 52 —— 一次跳变（mousedown 的延时回调或原生行为）。
// from=52 = cell0 末尾（cellStart+content.size+1? 计算：cellStart=2,
// target=3, near(3,1)=3? 但 from=52 —— 52 是 near() 把光标放到了
// 【cell 内容末尾】（cell0: start=3, content size=2 → 末尾=5？）
// 不对 —— 52 恰好 = 第一个 cell 的【doc 末尾偏移】？小 doc:
// p(2) table(start=3, size=?) —— 咱不猜了。关键问题：是 handler 跑了
// 还是原生点击 td 起效。判定法：hit 若没找到会 return（无 preventDefault
// 无延时回调）—— from 不变。from 变了 → handler 跑了（或原生）。
// ★ 一锤定音：点击【td 的间隙】（行间 border 区，hit=null）→ from 必须不变；
// 再点 td 中心但【预先劫持 v.dispatch 计数】：
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
// 劫持 dispatch
await p.evaluate(() => {
  const v = window.__pmView
  const orig = v.dispatch.bind(v)
  window.__dispatches = []
  v.dispatch = (tr) => { window.__dispatches.push('SEL:' + (tr.selection ? tr.selection.from : -1)); return orig(tr) }
})
const box = await p.evaluate(() => { const r = document.querySelector('td').getBoundingClientRect(); return { x: r.x + r.width * 0.6, y: r.y + r.height * 0.5 } })
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(900)
console.log('dispatch 记录:', JSON.stringify(await p.evaluate(() => window.__dispatches)))
console.log('addRange 有吗：', JSON.stringify(await p.evaluate(() => window.__addRanges || '未劫持')))
await b.close()
