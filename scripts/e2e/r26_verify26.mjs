// window 上没有任何 pointerdown/mousedown 监听器（React 用 root 委托）！
// 那么之前的「事件不到 window」其实意味着：事件没有派发。
// 但 about:blank 复制全部（包括 React 委托？不 —— about:blank 没有 React）。
// probe36 的对比不公平 —— 它没有 React 事件系统！
// React 17+ 把所有事件委托到 root container（#root）的 capture+bubble。
// ★★★ 灵光：React root 的 capture 监听器在 #root 上 —— 但如果 React
// 在 capture 里对某事件调了 stopPropagation？React 不这么干。
// ★★★★ 等等！！真相可能在 React 的「onScroll」—— DocumentEditor 的
// editorScroll 有 onScroll={syncScroll}。React 17 的 scroll 监听是 passive
// 且不相关。
// 换终极武器：用 CDP 的 EventListenerBreakpoint！断在 pointerdown 派发，
// 看有没有被断下（事件真的没派发）vs 直接跑过去（派发了但 JS 层面无监听）：
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 100)))
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
await p.evaluate(() => window.__setDocForTest({ meta: { title: 't' }, blocks: [
  { type: 'table', rows: [[{ inline: [{ text: 'A1' }] }, { inline: [{ text: 'B1' }] }]] },
] }))
await p.waitForTimeout(2000)
// 用 CDP Input domain 开启事件抑制诊断：dispatch 前后读 input 事件计数
const cdp = await p.context().newCDPSession(p)
// 监听 Input 事件被浏览器处理前 —— CDP 无此钩子。
// 换方法：EventEmitter on 'Input.dispatchMouseEvent'（不适用于浏览器内部）。
// ★ 用 Debugger.setInstrumentationBreakpoint (DOMEvent) — 若事件派发会 pause。
// headless 无 inspector UI —— 用 CDP Debugger domain 收 paused 事件：
await cdp.send('Debugger.enable')
await cdp.send('Debugger.setInstrumentationBreakpoint', { eventName: 'EventListener' })
let pausedEvents = []
cdp.on('Debugger.paused', (msg) => {
  if (msg.reason === 'instrumentation') {
    pausedEvents.push(msg.data ? msg.data.eventName || '?' : '?')
  }
  cdp.send('Debugger.resume').catch(() => {})
})
await p.evaluate(() => { window.__log = [] })
const box = await p.evaluate(() => { const r = document.querySelector('.ProseMirror td').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(800)
console.log('instrumentation pauses (EventListener fired):', JSON.stringify(pausedEvents.slice(0, 20)))
await b.close()
