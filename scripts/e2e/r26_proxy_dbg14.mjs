// from 始终 52 —— 不管设 26 还是 mouseup preventDefault。52 是稳定的
// 「别的来源」。这个 52 是谁设的？插桩 dispatchTransaction：
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 100)))
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
// 记录每次 dispatch 的 selection 来源
await p.evaluate(() => {
  window.__dlog = []
  const v = window.__pmView
  const orig = v.dispatch.bind(v)
  v.dispatch = (tr) => {
    window.__dlog.push((tr.selectionSet ? 'SEL→' + tr.selection.from : 'doc') + ' stack:' + (new Error().stack.split('\n')[2] || '').trim().slice(0, 80))
    return orig(tr)
  }
})
// 简化点击：直接在 evaluate 里模拟代理层逻辑（不经真实鼠标 —— 消除变量）
await p.evaluate(() => {
  const v = window.__pmView
  let tablePos = -1
  v.state.doc.forEach((n, off) => { if (tablePos < 0 && n.type.name === 'table') tablePos = off })
  const cellStart = tablePos + 3
  v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.near(v.state.doc.resolve(cellStart), 1)))
  v.focus()
})
await p.waitForTimeout(400)
console.log('dispatch 日志:', JSON.stringify(await p.evaluate(() => window.__dlog)))
console.log('最终 from:', await p.evaluate(() => window.__pmView.state.selection.from), 'focus:', await p.evaluate(() => window.__pmView.hasFocus()))
await p.keyboard.type('Q', { delay: 80 })
await p.waitForTimeout(400)
console.log('td[0]:', JSON.stringify(await p.evaluate(() => document.querySelector('td')?.textContent)))
await b.close()
