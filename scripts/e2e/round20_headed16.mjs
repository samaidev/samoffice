// 表0 非跨页、无位移行 —— 但整表在文档 y=9957（滚动前）。
// 点击的失败区 y=515..565 只是【视口坐标】。位移假设被否定（displaced=0）。
// 
// ★★★ 一个更早被忽略的事实：probe15 里 scroller y=215 h=655 → 底=870。
// 但「视口死区」从 y≈540 开始。870-540=330 ≠ 0。而 900-540=360。
// 死区顶 540 ≈ scroller 顶 215 + scroller 高 655/2？不对。
// —— 试最后一种解释：整页有【第二个滚动条】。window 本身可滚（body 高 > 视口）？
// 若 body 可滚且页面被滚动了 X，鼠标事件按【视口】坐标派发 —— 应无错位。
// 直接问：点 (309, 541) 时 Playwright 实际发给浏览器的坐标是什么？
// 用 CDP Input.setIgnoreInputEvents(false) + 监听 Input.dispatchMouseEvent?
// 更直接 —— 独立最小复现页面！只放一个 contenteditable + table，验证
// 同坐标点击：
import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--no-sandbox'], headless: false })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
await p.setContent(`<div style="height:1000px"></div>
<div contenteditable="true" style="margin-top:100px">
<table border="1"><tr><td style="height:60px">CELLTEXT</td></tr></table>
</div>`)
await p.evaluate(() => {
  window.__hits = []
  window.addEventListener('mousedown', e => window.__hits.push(Math.round(e.clientY)), true)
})
// 表格在页面 y≈1100 —— 需滚动。让 Playwright click 自动滚
const td = await p.$('td')
await td.click({ position: { x: 30, y: 30 } })
await p.waitForTimeout(300)
const hits = await p.evaluate(() => window.__hits)
console.log('最小复现点击命中:', JSON.stringify(hits), hits.length ? 'OK-无bug' : 'BUG也复现!')
await b.close()
