// anchor=P（DOM selection 在 P 上，不在 text node —— findText 失败？
// td 里结构是 <p><span>A1</span></p>，span 里是 text。findText 应找到。
// 可能 removeAllRanges 后 PM 的 selectionToDOM 又改回 P。
// ◆ 换更直接的方式：不用 DOM selection —— 用 beforeinput 捕获 + 
// PM insertText：在编辑器上监听 keydown（PM 已收 keydown —— focus=true
// 时 keydown 到 view.dom！），把字符插入 selection 位置。
// 但 PM 的 keymap 走 DOM selection…… 实际上 PM 的 input 处理基于
// beforeinput + 自身 state.selection —— PM 收到 keydown 后用自己的
// selection 处理输入！为什么没输入？—— focus 后 keydown 到了 view.dom，
// PM 处理输入用 view.state.selection（我们设了 from=52）—— 应该工作！
// 除非 keydown 被【代理层】吞了 —— 代理层 z-index:6 且 focus 时浏览器
// 把焦点给了…… focus() 后 activeElement=view.dom —— keydown 应到 dom。
// 诊断：keydown 到底到哪了 + beforeinput 是否触发：
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
await p.evaluate(() => {
  window.__log = []
  for (const ev of ['keydown', 'beforeinput', 'input', 'keypress']) {
    window.addEventListener(ev, e => window.__log.push(ev + ':' + (e.key || e.inputType || '')), { capture: true, passive: true })
  }
})
// 手动设 selection（不经代理层 —— 直接 evaluate 设 PM selection + focus）
await p.evaluate(() => {
  const v = window.__pmView
  let tablePos = -1
  v.state.doc.forEach((n, off) => { if (tablePos < 0 && n.type.name === 'table') tablePos = off })
  // cell 0 内容末尾: table+1(row)+1(cell)+content
  const target = tablePos + 3
  v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.near(v.state.doc.resolve(target))))
  v.focus()
})
await p.waitForTimeout(250)
console.log('PM sel from:', await p.evaluate(() => window.__pmView.state.selection.from), 'focus:', await p.evaluate(() => window.__pmView.hasFocus()))
await p.keyboard.type('Q', { delay: 80 })
await p.waitForTimeout(400)
console.log('事件:', JSON.stringify(await p.evaluate(() => window.__log)))
console.log('td[0]:', JSON.stringify(await p.evaluate(() => document.querySelector('td')?.textContent)))
console.log('doc 完整:', JSON.stringify(await p.evaluate(() => { const a = []; window.__pmView.state.doc.forEach(n => a.push(n.type.name)); return a })))
await b.close()
