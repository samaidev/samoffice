// proxy 存在、几何正确、elementFromPoint=proxy —— 但 mousedown 不触发。
// 【重要新事实】r27_t12 等 2000ms 后 proxy 在顶部 —— 现在点击它，
// 并同时数 [proxy handler 是否执行]：
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
await p.waitForTimeout(2000)
// 劫持 dispatch + addRange
await p.evaluate(() => {
  const v = window.__pmView
  const orig = v.dispatch.bind(v)
  window.__dispatches = []
  v.dispatch = (tr) => { window.__dispatches.push('SEL:' + (tr.selection ? tr.selection.from : -1)); return orig(tr) }
  window.__addRanges = []
  const origAdd = Selection.prototype.addRange
  Selection.prototype.addRange = function (...args) { window.__addRanges.push((args[0]?.startContainer?.nodeName || '?')); return origAdd.apply(this, args) }
})
const box = await p.evaluate(() => { const r = document.querySelector('td').getBoundingClientRect(); return { x: r.x + r.width * 0.6, y: r.y + r.height * 0.5 } })
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(900)
console.log('dispatch:', JSON.stringify(await p.evaluate(() => window.__dispatches)))
console.log('addRange:', JSON.stringify(await p.evaluate(() => window.__addRanges)))
console.log('最终:', JSON.stringify(await p.evaluate(() => ({ from: window.__pmView.state.selection.from, anchor: window.getSelection()?.anchorNode?.nodeName, anchorInTd: !!window.getSelection()?.anchorNode?.parentElement?.closest('td') }))))
await b.close()
