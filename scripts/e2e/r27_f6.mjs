// f5 HIT 但 final 仍 from=52 且打字不进 —— HIT 探针（capture 在我们
// evaluate 里挂的）能收，但【产品 handler】（建层时挂的 mousedown）
// 没跑？f5 的探针计数器与我们产品 handler 并存 —— 探针 HIT 但
// applySel 的 dispatch 没发生（from=52）。
// ★ 可能产品 handler 的 hit 匹配失败 return 了：坐标在 td 上但
// rows.forEach 的 rect 匹配 —— f5 点击点与 final 相同 —— 
// 应该匹配…… 除非产品 handler 抛异常（e.preventDefault 前）——
// 捕获方式：给 handler 首行插桩不行（产品代码）。
// 用 dispatch 劫持 + addRange 劫持再跑 final 的精确序列：
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
await p.waitForTimeout(3000)
const pb = await p.evaluate(() => { const r = document.querySelector('.ProseMirror p').getBoundingClientRect(); return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.5 } })
await p.mouse.click(pb.x, pb.y)
await p.waitForTimeout(2600)
// 劫持
await p.evaluate(() => {
  const v = window.__pmView
  const orig = v.dispatch.bind(v)
  window.__ds = []
  v.dispatch = (tr) => { window.__ds.push('SEL:' + (tr.selection ? tr.selection.from : -1)); return orig(tr) }
  window.__ar = []
  const origAdd = Selection.prototype.addRange
  Selection.prototype.addRange = function (...a) { window.__ar.push((a[0]?.startContainer?.nodeName || '?') + (a[0]?.startContainer?.parentElement?.closest('td') ? '(td)' : '')); return origAdd.apply(this, a) }
})
const box = await p.evaluate(() => { const r = document.querySelector('td').getBoundingClientRect(); return { x: r.x + r.width * 0.6, y: r.y + r.height * 0.5 } })
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(800)
console.log('dispatch:', JSON.stringify(await p.evaluate(() => window.__ds)))
console.log('addRange:', JSON.stringify(await p.evaluate(() => window.__ar)))
await b.close()
