// 最后一个假设，一次跑完三组实验：
// A) 把 PM 挂 mousedown 的 dom listener 移除（克隆法，无法移除 addEventListener
//    的匿名函数 —— 但可以整个替换 pm.dom 的父级…… 太重）
// B) @pandaghost 终极手段：**Input.dispatchMouseEvent 带 'pointerType':'mouse'**
//    已默认。试 dispatch 到 td 的父级坐标 ±0.5 像素（亚像素坐标）：
// C) dispatch 每个候选层 —— 之前只试过 td 中心。试「点击 td 的左上角内部 2px」
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
await p.evaluate(() => window.__setDocForTest({ meta: { title: 't' }, blocks: [
  { type: 'table', rows: [[{ inline: [{ text: 'A1' }] }, { inline: [{ text: 'B1' }] }]] },
] }))
await p.waitForTimeout(2000)
const r = await p.evaluate(() => {
  const td = document.querySelector('.ProseMirror td')
  const b = td.getBoundingClientRect()
  return { l: b.left, t: b.top, w: b.width, h: b.height }
})
await p.evaluate(() => { window.__e = []; window.addEventListener('pointerdown', e => window.__e.push(e.target.tagName + '@' + Math.round(e.clientX) + ',' + Math.round(e.clientY)), { capture: true, passive: true }) })
// 网格扫描整个 td 4px 步长
for (let dx = 2; dx < r.w; dx += 12) {
  for (let dy = 2; dy < r.h; dy += 6) {
    await p.mouse.click(r.l + dx, r.t + dy)
    await p.waitForTimeout(30)
  }
}
const evs = await p.evaluate(() => window.__e)
console.log('grid hits:', evs.length, '/', Math.floor(r.w / 12) * Math.floor(r.h / 6), JSON.stringify(evs.slice(0, 6)))
await b.close()
