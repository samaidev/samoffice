// 产品代码仍 from=52。final2 的补刀是【点击后 200ms 的 evaluate】—— 
// 产品补刀在 setTimeout(60)。原生 caret 覆盖发生在 mouseup 的
// 【click 事件处理】—— 时序：mousedown(pd) → 我们的 setTimeout(0) →
// mouseup(pd) → click（原生 caret!）→ 我们的 setTimeout(60)。
// 补刀 60ms 应该在 click 之后…… 但实测 from=52 —— 补刀没生效或
// 也被覆盖。加 console 探针确认补刀执行与最终值：
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('console', m => { const t = m.text(); if (t.startsWith('R27X')) console.log('LOG:', t.slice(0, 100)) })
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
// 观察产品 applySel 的效果：连续轮询 from 25/52 的交替
await p.evaluate(() => {
  window.__fromTrace = []
  const iv = setInterval(() => window.__fromTrace.push(Math.round(performance.now()) + ':' + window.__pmView.state.selection.from), 10)
  setTimeout(() => clearInterval(iv), 500)
})
const box = await p.evaluate(() => { const r = document.querySelector('td').getBoundingClientRect(); return { x: r.x + r.width * 0.6, y: r.y + r.height * 0.5 } })
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(700)
const trace = await p.evaluate(() => window.__fromTrace.filter((s, i, a) => i === 0 || s.split(':')[1] !== a[i-1].split(':')[1]))
console.log('from 轨迹:', JSON.stringify(trace))
await p.keyboard.type('Q5', { delay: 70 })
await p.waitForTimeout(400)
console.log('td[0]:', JSON.stringify(await p.evaluate(() => document.querySelector('td')?.textContent)))
await b.close()
