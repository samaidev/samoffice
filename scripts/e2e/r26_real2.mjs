// 内容正常渲染了（A1/B1），点击仍死 —— 死区真实存在。
// 现在重跑关键对照（内容修正后）：
// A) 重写 body 后点击（是否仍 ALIVE？）
// B) factor15 原位重插
// C) display:none 双帧
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
await p.evaluate(() => window.__setDocForTest({ meta: { title: 't' }, blocks: [
  { type: 'p', inline: [{ content: '段落内容' }] },
  { type: 'table', rows: [
    [{ inline: [{ content: 'A1' }] }, { inline: [{ content: 'B1' }] }],
    [{ inline: [{ content: 'A2' }] }, { inline: [{ content: 'B2' }] }],
  ] },
] }))
await p.waitForTimeout(3000)
const clickTd = async (i = 0) => {
  await p.evaluate(() => { window.__ev = 0; window.addEventListener('pointerdown', () => window.__ev++, { capture: true, passive: true }) })
  const box = await p.evaluate((idx) => { const tds = [...document.querySelectorAll('.ProseMirror td')]; const r = tds[idx].getBoundingClientRect(); return { x: r.x + r.width * 0.7, y: r.y + r.height * 0.5 } }, i)
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(280)
  return (await p.evaluate(() => window.__ev)) > 0
}
console.log('baseline:', await clickTd() ? 'ALIVE' : 'DEAD')
// A) 重写 body
await p.evaluate(() => { document.body.innerHTML = document.body.innerHTML })
await p.waitForTimeout(600)
console.log('A 重写body后:', await clickTd() ? 'ALIVE ✅' : 'DEAD')
// B/C 用新页面重做（重写后 PM 已废）
const p2 = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
await p2.goto(BASE, { waitUntil: 'networkidle' })
await p2.waitForTimeout(1200)
await p2.evaluate(() => window.__setDocForTest({ meta: { title: 't' }, blocks: [
  { type: 'p', inline: [{ content: '段落内容' }] },
  { type: 'table', rows: [
    [{ inline: [{ content: 'A1' }] }, { inline: [{ content: 'B1' }] }],
    [{ inline: [{ content: 'A2' }] }, { inline: [{ content: 'B2' }] }],
  ] },
] }))
await p2.waitForTimeout(3000)
const clickTd2 = async () => {
  await p2.evaluate(() => { window.__ev = 0; window.addEventListener('pointerdown', () => window.__ev++, { capture: true, passive: true }) })
  const box = await p2.evaluate(() => { const r = document.querySelector('.ProseMirror td').getBoundingClientRect(); return { x: r.x + r.width * 0.7, y: r.y + r.height * 0.5 } })
  await p2.mouse.click(box.x, box.y)
  await p2.waitForTimeout(280)
  return (await p2.evaluate(() => window.__ev)) > 0
}
// B) 原位重插
await p2.evaluate(() => {
  const w = document.querySelector('.tableWrapper')
  const parent = w.parentElement, next = w.nextSibling
  parent.removeChild(w); parent.insertBefore(w, next)
})
await p2.waitForTimeout(400)
console.log('B 原位重插:', await clickTd2() ? 'ALIVE ✅' : 'DEAD')
// C) display:none 双帧
await p2.evaluate(() => new Promise(resolve => {
  const w = document.querySelector('.tableWrapper')
  w.style.display = 'none'
  requestAnimationFrame(() => requestAnimationFrame(() => { w.style.display = ''; setTimeout(resolve, 250) }))
}))
console.log('C display双帧:', await clickTd2() ? 'ALIVE ✅' : 'DEAD')
// D) 移出 PM 到 body（factor19 复刻）
const box4 = await p2.evaluate(() => {
  const w = document.querySelector('.tableWrapper')
  const holder = document.createElement('div')
  const r = w.getBoundingClientRect()
  holder.style.cssText = `position:fixed;left:${r.x}px;top:${Math.min(r.y + 280, 700)}px;z-index:99999;background:#fff;border:2px solid #d33;width:440px`
  document.body.appendChild(holder)
  holder.appendChild(w)
  window.__ev = 0
  window.addEventListener('pointerdown', () => window.__ev++, { capture: true, passive: true })
  const hr = holder.getBoundingClientRect()
  return { x: hr.x + 120, y: hr.y + 30 }
})
await p2.waitForTimeout(400)
await p2.mouse.click(box4.x, box4.y)
await p2.waitForTimeout(250)
console.log('D 移出PM到body:', (await p2.evaluate(() => window.__ev)) > 0 ? 'ALIVE ✅' : 'DEAD')
await b.close()
