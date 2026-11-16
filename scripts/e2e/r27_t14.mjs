// SEL:52 = PM 原生（我们 dispatch 从未跑）—— proxy handler 不触发。
// 但 SEL:52 本身说明【td 的 mousedown 事件 PM 收到了】！！
// ★★★★ 等等 —— PM 收到了原生 mousedown？！死区的定义是「事件不派发」
// —— 但 PM 的 dispatch SEL:52 证明【mousedown 派发了、PM 处理了】！
// 只是从没到达 window capture 计数器和 proxy —— 
// ◆◆◆ 全新的问题定性：**事件派发了，PM 收到了，但派发目标不是 DOM
// 树里的任何元素（window/proxy 都收不到）** —— 事件被派发到
// 【合成器内部的已删除节点】！
// ★ 这解释了一切：PM 能收（PM 监听 view.dom 的 handleDOMEvents 也是
// DOM 派发 —— 不 —— PM 收到的是 52 —— 也许是 keyboard/其他）。
// ◆ 验证：SEL:52 是什么时机 dispatch 的 —— 点击时还是自动？
//（可能是拼写检查/分页的周期性 dispatch 恰好 SEL:52）
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
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
await p.waitForTimeout(2500)
const pb = await p.evaluate(() => { const r = document.querySelector('.ProseMirror p').getBoundingClientRect(); return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.5 } })
await p.mouse.click(pb.x, pb.y)
await p.waitForTimeout(2000)
// 劫持 dispatch 但【不点击】—— 观察 SEL:52 是否自动出现
await p.evaluate(() => {
  const v = window.__pmView
  const orig = v.dispatch.bind(v)
  window.__dispatches = []
  v.dispatch = (tr) => { window.__dispatches.push('SEL:' + (tr.selection ? tr.selection.from : -1)); return orig(tr) }
})
await p.waitForTimeout(1500)
console.log('不点击时 dispatch:', JSON.stringify(await p.evaluate(() => window.__dispatches)))
// 再劫持 selection 读取 —— from 52 是什么时候设置的
const t0 = await p.evaluate(() => window.__pmView.state.selection.from)
console.log('当前 from:', t0)
await b.close()
