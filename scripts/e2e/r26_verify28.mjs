// #root 有 React 的 pointerdown/mousedown 委托（两组 = React18 双 root?）。
// pm dom 有 mousedown/dragstart/mouseup/click —— PM 直接挂的。
// ★★★ 但「事件不到我挂在 window 的 capture 监听」= 事件被
// stopImmediatePropagation 在【window capture 之前的某个阶段】……
// 不可能 —— capture 从 window 开始！
// 除非 —— 事件 target 不是 DOM 元素而是「浏览器内部」（如 resize handle）。
// ★★★★ 终极顿悟：**table 的 borders 被 Chromium 识别为「表格调整把手」！**
// <table> 在 contenteditable 里，Chromium 给 td 边缘提供原生 resize 行为！
// 但这只吞边缘…… 中心呢？
// 不对。让我直接看 PM 挂在 dom 上的 mousedown 处理器是否会
// stopPropagation —— PM 源码：view.dom 的 mousedown 是 bubbles 的，且 PM
// 在 handleDOMEvents 返回 true 时 preventDefault。但事件仍应到达 window
// capture（capture 在 target 之前！）
// ……………… 除非事件 target 在【另一个 document】！
// ★★★★★★ 检查 td 是否真的在主 document —— 之前查过 tdOwnerDoc=true。
// 那只剩最后一种可能：**Playwright 的 mouse.click 坐标被 round 到了
// 别的元素上**。查 box 坐标 elementFromPoint 与实际点击 target ——
// 之前 elementFromPoint=SPAN(TD内) —— 但那是我 evaluate 的坐标；
// mouse.click 用相同坐标 —— 一致。
// 认输前最后一招：p.locator('td').click() + trace 动作日志（Playwright
// 自带 actionability + 实际点击点日志）：
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('console', m => { if (m.text().includes('R26')) console.log('PAGE:', m.text()) })
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 100)))
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
await p.evaluate(() => window.__setDocForTest({ meta: { title: 't' }, blocks: [
  { type: 'table', rows: [[{ inline: [{ text: 'A1' }] }, { inline: [{ text: 'B1' }] }]] },
] }))
await p.waitForTimeout(2000)
// 在 td 上挂 capture（target 阶段前的捕获：从 window 开始）
await p.evaluate(() => {
  window.__chain = []
  const mk = (stage) => (e) => window.__chain.push(stage + ':' + e.target.tagName + ':stopped=' + e.cancelBubble)
  // 用 getEventListeners 无法 —— 直接在 window/document/td 三级挂
  window.addEventListener('pointerdown', mk('win-cap'), { capture: true, passive: true })
  document.addEventListener('pointerdown', mk('doc-cap'), { capture: true, passive: true })
  const td = document.querySelector('.ProseMirror td')
  td.addEventListener('pointerdown', mk('td-cap'), { capture: true, passive: true })
  td.addEventListener('pointerdown', mk('td-tgt'), { passive: true })
})
// 用 locator click（Playwright 会等待 actionability）
try {
  await p.locator('.ProseMirror td').first().click({ timeout: 6000 })
  console.log('locator click completed')
} catch (e) { console.log('locator click err:', e.message.slice(0, 100)) }
await p.waitForTimeout(300)
console.log('chain:', JSON.stringify(await p.evaluate(() => window.__chain)))
await b.close()
