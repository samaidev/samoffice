// 关键发现：selection 时序只有一条 "P"（PM 的 selectionToDOM 把 anchor
// 设到了 P 元素而非文本节点 —— PM 知道 from=52 但 DOM 映射落在 P 上）。
// 而且整个时序只有 1 条 —— 我们管理器的 setRange 代码【根本没执行】
//（若执行了会有第二条 selectionchange）！
// → 管理器的 DOM-sel 同步代码没跑。可能：tn 找到了但代码在 v.focus()
// 之后被 PM 的异步 flush 覆盖…… 不 —— 没有第二条 change = 我们的
// removeAllRanges/addRange 从未执行。tdEl/tn 是 null？
// td 结构 = <P>"A1"（文本在 P 里）—— findText 应该找到……
// ★ 除非延时回调抛异常走了 catch（v.focus()）—— 但 focus 不报错。
// 插桩验证：直接检查那段代码的执行。
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 150)))
p.on('console', m => { if (m.text().includes('R27')) console.log('LOG:', m.text().slice(0, 150)) })
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
// 猴子补 console：捕获 proxy mousedown 里发生的事
// 劫持 getSelection().addRange 记录调用
await p.evaluate(() => {
  const orig = Selection.prototype.addRange
  window.__addRanges = []
  Selection.prototype.addRange = function (...args) {
    window.__addRanges.push((args[0]?.startContainer?.nodeName || '?') + (args[0]?.startContainer?.parentElement?.closest('td') ? '(td)' : ''))
    return orig.apply(this, args)
  }
})
const pb = await p.evaluate(() => { const r = document.querySelector('.ProseMirror p').getBoundingClientRect(); return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.5 } })
await p.mouse.click(pb.x, pb.y)
await p.waitForTimeout(600)
await p.evaluate(() => { window.__addRanges = [] })
const box = await p.evaluate(() => { const r = document.querySelector('td').getBoundingClientRect(); return { x: r.x + r.width * 0.6, y: r.y + r.height * 0.5 } })
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(900)
console.log('addRange 调用记录:', JSON.stringify(await p.evaluate(() => window.__addRanges)))
console.log('最终 anchor:', JSON.stringify(await p.evaluate(() => ({ node: window.getSelection()?.anchorNode?.nodeName, inTd: !!window.getSelection()?.anchorNode?.parentElement?.closest('td'), from: window.__pmView.state.selection.from }))))
await b.close()
