// zoom 无效。既然是 hit-test 快照问题 —— 看看真实 Chromium 版本特征，
// 再试「同页面 window.open 新窗口装载同 app」是否复现（排除 per-document
// 状态）。同时测「同页第二个 iframe 装同 app」—— iframe 是独立 compositor
// frame！若 iframe 内正常 → 用 iframe 方案兜底不现实，但能确诊。
// 更实用的一招没试过：**把整个编辑器滚动容器 editorScroll 换成新节点**
//（重写 body 等价但保留 React —— 不行 React 全废）。
// ◆ 换个维度：**滚动**！死区也许与「编辑器从未被滚动过」有关 ——
// Chromium 首次滚动会强制 layer 重建。之前 scrollIntoView 都做过 —— 
// 但那是在 setDoc 后 2.5s，也许太晚。试「点击前 scrollTop ±1」：
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
const test = async (name, fn) => {
  await p.evaluate(fn.toString())
  await p.waitForTimeout(300)
  await p.evaluate(() => { window.__ev = 0; window.addEventListener('pointerdown', () => window.__ev++, { capture: true, passive: true }) })
  const box = await p.evaluate(() => { const r = document.querySelector('.ProseMirror td').getBoundingClientRect(); return { x: r.x + r.width * 0.7, y: r.y + r.height * 0.5 } })
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(250)
  console.log(`${name}:`, (await p.evaluate(() => window.__ev)) > 0 ? 'ALIVE ✅' : 'DEAD')
}
await test('baseline', () => {})
await test('scrollTop 抖动', () => {
  const sc = document.querySelector('.flex-1.overflow-auto')
  const st = sc.scrollTop
  sc.scrollTop = st + 1
  sc.scrollTop = st
})
await test('editorScroll 滚动 100 再回', () => {
  const sc = document.querySelector('.flex-1.overflow-auto')
  const st = sc.scrollTop
  sc.scrollTop = st + 100
  requestAnimationFrame(() => { sc.scrollTop = st })
})
await test('window.scrollTo', () => { window.scrollTo(0, 1); window.scrollTo(0, 0) })
await b.close()
