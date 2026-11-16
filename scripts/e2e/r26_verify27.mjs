// setInstrumentationBreakpoint 参数应为 eventName: 'listener'？
// 正确名是 'EventListener' 的变体 —— CDP 里是 'listener'。
// 其实有更直接的：之前 React root 委托 —— 查 #root 的监听器！
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
const cdp = await p.context().newCDPSession(p)
const dumpListeners = async (expr) => {
  const { result } = await cdp.send('Runtime.evaluate', { expression: expr })
  if (!result.objectId) return expr + ' → no object'
  const ls = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId })
  return ls.listeners.filter(l => ['pointerdown','mousedown','mouseup','click','pointerup','pointermove','dragstart','selectstart'].includes(l.type))
    .map(l => `${l.type} cap=${l.capture}`)
}
console.log('#root:', JSON.stringify(await dumpListeners('document.getElementById("root")')))
console.log('document:', JSON.stringify(await dumpListeners('document')))
console.log('body:', JSON.stringify(await dumpListeners('document.body')))
console.log('pm dom:', JSON.stringify(await dumpListeners('window.__pmView.dom')))
console.log('wrapper:', JSON.stringify(await dumpListeners('document.querySelector(".tableWrapper")')))
console.log('td:', JSON.stringify(await dumpListeners('document.querySelector(".ProseMirror td")')))
await b.close()
