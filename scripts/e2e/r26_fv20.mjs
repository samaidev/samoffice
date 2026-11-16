// 干净 vite 仍 from=1。fv17 已证：同时刻同位置，evaluate 建的 twin 活、
// DocTableView 建的 proxy 死。fv18 两种写法都活。
// 剩一个没复刻的差异：**正式 handler 是闭包 this 绑定的（cellAtPoint/
// cellContentStart 调 this.table.rows / this.getPos()）**—— 但到达与否
// 在 handler 之前（capture 计数）……
// ◆◆◆ 等等！！！ fv17 里我给 proxy 插桩用 capture:true，
// twin 用默认（bubble）！capture 计数器 vs proxy 自己的 handler
// 是两回事 —— fv9/fv14/fv17 的「事件 []」全部基于【后插的 capture
// 监听】。如果 Chromium 对【后插 capture 监听】的层不派发（监听器在
// hit-test 快照之后挂）—— 而原生 handler（创建时挂的）正常呢？！
// fv17 的 proxy 原生 handler（创建时挂的 mousedown）会跑吗？
// 看证据：fv17 点击后 selection 若变了说明原生 handler 跑了。
// 立即验证：不插桩，直接点击正式 proxy，看 selection/focus 变化：
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
await p.waitForTimeout(5500) // 4s 创建 + 余量
// 不插桩直接点 + 打字
const box = await p.evaluate(() => { const r = document.querySelector('td').getBoundingClientRect(); return { x: r.x + r.width * 0.6, y: r.y + r.height * 0.5 } })
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(600)
console.log('原生handler点击:', JSON.stringify(await p.evaluate(() => ({ from: window.__pmView.state.selection.from, focus: window.__pmView.hasFocus() }))))
await p.keyboard.type('Q5', { delay: 60 })
await p.waitForTimeout(400)
console.log('td[0]:', JSON.stringify(await p.evaluate(() => document.querySelector('td')?.textContent)))
await b.close()
