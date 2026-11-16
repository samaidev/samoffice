// 候选锁定：React 委托的 selectionchange + DocumentEditor:2658 的
// selectionchange + DocTableView 的 document mousemove。
// 逐一禁用验证（劫持 removeEventListener 无效 —— 用「重写 DOM 后逐个重建」太重）。
// ◆ 快刀：删除 React 委托 + DocumentEditor 的 selectionchange 的效果 =
// 重写 DOM 已经全废了。改成【只废 document 上的监听】：
// 劫持：把 document 的 dispatch 拦截 —— EventTarget 派发不可拦。
// ★ 换最直接的实验组合：重写 body 后 ALIVE，然后在【重写后的页面】手动
// 逐个加回监听器（React 委托 / selectionchange(纯读) / mousemove(纯读)），
// 看哪个把死区带回来：
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
// 重写 DOM（清全部监听）
await p.evaluate(() => { const h = document.body.innerHTML; document.body.innerHTML = h })
await p.waitForTimeout(500)
const clickTd = async () => {
  await p.evaluate(() => { window.__ev = 0; window.addEventListener('pointerdown', () => window.__ev++, { capture: true, passive: true }) })
  const box = await p.evaluate(() => { const r = document.querySelector('.ProseMirror td').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(250)
  return (await p.evaluate(() => window.__ev)) > 0
}
console.log('重写后 baseline:', await clickTd() ? 'ALIVE' : 'DEAD')
// 逐个加回
await p.evaluate(() => {
  // 1) React 式委托（root 上 capture+bubble，同 React 18 集合）
  for (const ev of ['pointerdown','pointermove','pointerup','mousedown','mouseup','click','dragstart','drop','dragover','wheel']) {
    document.getElementById('root').addEventListener(ev, () => {}, false)
    document.getElementById('root').addEventListener(ev, () => {}, true)
  }
})
await p.waitForTimeout(300)
console.log('+ React 式 root 委托:', await clickTd() ? 'ALIVE' : 'DEAD')
// 2) document selectionchange ×2（模拟 PM + DocumentEditor 的两个）
await p.evaluate(() => {
  document.addEventListener('selectionchange', () => { const s = window.getSelection(); void s?.anchorNode?.nodeName })
  document.addEventListener('selectionchange', () => { const s = window.getSelection(); void s?.rangeCount })
})
await p.waitForTimeout(300)
console.log('+ 2 个 selectionchange:', await clickTd() ? 'ALIVE' : 'DEAD')
// 3) document mousemove（模拟 DocTableView 的 onDocMove，读 getBoundingClientRect）
await p.evaluate(() => {
  document.addEventListener('mousemove', (e) => {
    const t = document.querySelector('.ProseMirror table')
    if (t) { const r = t.getBoundingClientRect(); if (e.clientX >= r.left && e.clientY >= r.top) void 0 }
  })
})
await p.waitForTimeout(300)
console.log('+ mousemove(读 rect):', await clickTd() ? 'ALIVE' : 'DEAD')
await b.close()
