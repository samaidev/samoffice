// 点击事件到了 ✅。但打字没进格 —— selection 问题。诊断：
// 点击后 PM selection 在哪？focus 了吗？
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 120)))
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
const box = await p.evaluate(() => { const r = document.querySelector('td').getBoundingClientRect(); return { x: r.x + r.width * 0.7, y: r.y + r.height * 0.5 } })
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(400)
const st = await p.evaluate((boxArg) => {
  const v = window.__pmView
  const s = v.state.selection
  return {
    selType: s.type?.name, from: s.from, to: s.to,
    focus: v.hasFocus(),
    domSel: window.getSelection()?.anchorNode?.nodeName,
    // posAtCoords 点击点映射
    pos: v.posAtCoords({ left: boxArg.x, top: boxArg.y })?.pos,
  }
}, box)
console.log('点击后状态:', JSON.stringify(st))
// 手动 focus + 光标放入格内再打字验证输入链路
await p.evaluate(() => {
  const v = window.__pmView
  // 把光标放到第一个 cell 开头
  v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.near(v.state.doc.resolve(3))))
  v.focus()
})
await p.waitForTimeout(200)
console.log('手动 focus 后 hasFocus:', await p.evaluate(() => window.__pmView.hasFocus()))
await p.keyboard.type('K', { delay: 50 })
await p.waitForTimeout(300)
console.log('td[0] after K:', JSON.stringify(await p.evaluate(() => document.querySelector('td')?.textContent)))
await b.close()
