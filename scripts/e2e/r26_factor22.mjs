// 静置零活动。死区是静态的。PM dom 内死、外活。
// factor9/10 的【迷你 PM】（应用内新建 EditorView）+ 表格在 host 里活了 ——
// 迷你 PM 的表在 PM dom 【外】（host 内同级）！没有测过【迷你 PM dom 内】的表！
// 补上：迷你 PM 的 doc schema 无 table —— 无法内置。
// 但可以直接把表 append 进迷你 PM 的 dom（会被 DOMObserver 删 —— 
// 但删之前点击；或用 PM 不 observe 的方式 —— 没有这种方式）。
// ★ 换成「应用真实 PM + 空 doc + 手动塞表」—— 一样被删。
// ◆◆ 唯一没排查的运行时差异：**document 级全局监听器**。
// React/PM/插件挂的 document/window 监听（factor3 只在 root 挂了，
// 没挂 document/window 级；PM 的 selectionchange 挂在 document！）。
// 逐一禁用全局监听器 → 每次点击 → 找出吞事件的那个：
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
await p.evaluate(() => window.__setDocForTest({ meta: { title: 't' }, blocks: [
  { type: 'p', inline: [{ text: '段落' }] },
  { type: 'table', rows: [[{ inline: [{ text: 'A1' }] }, { inline: [{ text: 'B1' }] }]] },
] }))
await p.waitForTimeout(2500)
const cdp = await p.context().newCDPSession(p)
// 列出 document + window 所有事件监听器
const dump = async (expr) => {
  const { result } = await cdp.send('Runtime.evaluate', { expression: expr })
  if (!result.objectId) return []
  const ls = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId })
  return ls.listeners.map(l => `${l.type}/${l.capture ? 'cap' : 'bub'}`)
}
console.log('window:', JSON.stringify(await dump('window')))
console.log('document:', JSON.stringify(await dump('document')))
await b.close()
