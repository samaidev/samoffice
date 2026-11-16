// 干净 vite 也 []。但 from=52 说明 dispatch 前半段跑了。
// → 内层 try 的 tdEl 段抛异常被 catch 吞了！
// r/c 在外层解构 —— 但内层用了 r、c …… 检查作用域：
// const { r, c } = hit 在 mousedown handler 里 —— 内层 setTimeout 闭包
// 应能访问。除非 —— v.focus() 之后 PM 的 domObserver 在同一微任务
// flush 时抛异常中断了 setTimeout 回调后续？dispatch 异常会走外层 catch
//（v.focus()）—— focus 有效（focus=true）→ 走的是外层 catch！
// ★ 即：dispatch 或 focus 之后、tdEl 之前有异常 —— 只能是
// (v.state.selection as any).constructor.near —— from=52 说明 dispatch
// 成功…… 不 —— from=52 也可能是 PM 内部 normalize 的结果。
// 用 window.onerror + unhandledrejection 抓真实异常：
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 200)))
p.on('console', m => { const t = m.text(); if (t.includes('R27') || /error/i.test(t)) console.log('CONSOLE:', t.slice(0, 200)) })
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
await p.evaluate(() => {
  window.__errs = []
  window.addEventListener('error', e => window.__errs.push('ERR:' + String(e.message).slice(0, 120)))
  window.addEventListener('unhandledrejection', e => window.__errs.push('REJ:' + String(e.reason).slice(0, 120)))
})
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
await p.waitForTimeout(600)
await p.evaluate(() => { window.__errs = [] })
const box = await p.evaluate(() => { const r = document.querySelector('td').getBoundingClientRect(); return { x: r.x + r.width * 0.6, y: r.y + r.height * 0.5 } })
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(900)
console.log('异常:', JSON.stringify(await p.evaluate(() => window.__errs)))
await b.close()
