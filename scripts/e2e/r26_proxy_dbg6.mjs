// mouseup 后 from 又回 1 —— 每次真实点击都有个【后置重置】。
// 抓住它：在 mouseup 到 reset 之间插桩 selectionchange 的发生次序。
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
// 插桩：mousedown/mouseup/selectionchange/focusin/focusout 时序
await p.evaluate(() => {
  window.__seq = []
  const log = (tag) => () => window.__seq.push(tag + '@' + Math.round(performance.now()))
  document.addEventListener('mousedown', log('md'), true)
  document.addEventListener('mouseup', log('mu'), true)
  document.addEventListener('selectionchange', log('selchange'))
  document.addEventListener('focusout', log('focusout'), true)
  document.addEventListener('focusin', log('focusin'), true)
  document.addEventListener('click', log('click'), true)
})
const box = await p.evaluate(() => { const td = document.querySelector('td'); const r = td.getBoundingClientRect(); return { x: r.x + r.width * 0.7, y: r.y + r.height * 0.5 } })
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(400)
console.log('时序:', JSON.stringify(await p.evaluate(() => window.__seq)))
console.log('最终:', JSON.stringify(await p.evaluate(() => ({ from: window.__pmView.state.selection.from, focus: window.__pmView.hasFocus() }))))
await b.close()
