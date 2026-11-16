// 仍 from=1 focus=false —— HMR 可能没重建 NodeView（旧 proxy 实例还带 CE 属性）。
// 检查页面上现存 proxy 的属性 + 手动移除属性再点击：
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
const info = await p.evaluate(() => {
  const proxy = document.querySelector('.pm-table-clickproxy')
  return { hasCE: proxy?.hasAttribute('contenteditable'), cursor: proxy ? getComputedStyle(proxy).cursor : null, style: proxy?.getAttribute('style') }
})
console.log('当前 proxy:', JSON.stringify(info))
// 手动清掉 CE 与 cursor（如果 HMR 旧实例还在），再点
await p.evaluate(() => {
  const proxy = document.querySelector('.pm-table-clickproxy')
  proxy?.removeAttribute('contenteditable')
  if (proxy) proxy.style.cursor = ''
})
const box = await p.evaluate(() => { const td = document.querySelector('td'); const r = td.getBoundingClientRect(); return { x: r.x + r.width * 0.7, y: r.y + r.height * 0.5 } })
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(350)
console.log('清除属性后点击:', JSON.stringify(await p.evaluate(() => ({ from: window.__pmView.state.selection.from, focus: window.__pmView.hasFocus() }))))
await p.keyboard.type('Q5', { delay: 60 })
await p.waitForTimeout(400)
console.log('td[0]:', JSON.stringify(await p.evaluate(() => document.querySelector('td')?.textContent)))
await b.close()
