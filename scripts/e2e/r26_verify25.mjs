// CSS 全不是。但 about:blank + 相同结构 + 相同 CSS 是 ALIVE（probe36/38）！
// 应用页 vs about:blank 的差异 = React 应用本身。哪个全局监听器会吞
// 【表格区域】的 pointerdown？！等等 —— 事件没到 window（capture 都没有）。
// JS 无法阻止 capture 在 window 触发…… 除非 stopImmediatePropagation 在
// window capture 监听器里先跑 —— 我的监听器挂在 window capture，另一个
// 也挂 window capture 的监听器若先注册并 stopImmediatePropagation，我的
// 就收不到！！查 document/window 上所有 pointerdown/mousedown 监听：
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 100)))
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
await p.evaluate(() => window.__setDocForTest({ meta: { title: 't' }, blocks: [
  { type: 'p', inline: [{ text: '第一段落' }] },
  { type: 'table', rows: [
    [{ inline: [{ text: 'A1' }] }, { inline: [{ text: 'B1' }] }],
    [{ inline: [{ text: 'A2' }] }, { inline: [{ text: 'B2' }] }],
  ] },
] }))
await p.waitForTimeout(2200)
// Chrome DevTools Protocol: DOMDebugger.getEventListeners on window/document/body
const cdp = await p.context().newCDPSession(p)
await p.evaluate(() => { window.__marker = 'win' }) // 确保 evaluate 可用
// 拿 window 的事件监听器（需要 Runtime + DOMDebugger）
const { result } = await cdp.send('Runtime.evaluate', { expression: 'window' })
const listenersWin = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId, depth: 0 })
const table = {}
for (const l of listenersWin.listeners) {
  const k = l.type + ':' + (l.capture ? 'cap' : 'bub') + ':' + (l.scriptId || '')
  table[k] = (table[k] || 0) + 1
}
console.log('window listeners:', JSON.stringify(table, null, 1))
// 找 pointerdown/mousedown 的监听器源码行
for (const l of listenersWin.listeners) {
  if (l.type === 'pointerdown' || l.type === 'mousedown') {
    console.log(l.type, 'cap=' + l.capture, 'line=' + (l.lineNumber + 1), 'col=' + l.columnNumber, 'script=' + l.scriptId, 'url=' + (l.url || '').slice(0, 60))
  }
}
await b.close()
