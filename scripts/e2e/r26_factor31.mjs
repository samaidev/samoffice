// 关键差异收敛：重写 body 后新建的 PM 活；真实应用 mount 的 PM 死。
// 但 factor10「#root 内直挂迷你 PM」活 —— 那也是【后建】的。
// 共同点：应用真实编辑器 = __setDocForTest → React render →
// DocumentEditor mount → useEffect 建 view。factor10/24/28/29 的
// 共同点 = 直接 new EditorView（无 React 组件、无其 hooks）。
// ★★★ 最后一验：React 组件挂载方式 vs 直接 new —— 用 React render
// 一个内含 new EditorView 的组件（ReactDOM.createRoot 二级 root）：
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
// 用真实应用的 DocumentEditor 再开一个（第二个窗口标签，同一文档不同 path）
// → 会走 React mount 建【第二个】真实编辑器 —— 原生对照！
const r2 = await p.evaluate(() => {
  window.__setDocForTest({ meta: { title: 't2' }, blocks: [
    { type: 'p', inline: [{ text: '第二文档段落' }] },
    { type: 'table', rows: [[{ inline: [{ text: 'X1' }] }, { inline: [{ text: 'Y1' }] }]] },
  ] })
  return true
})
await p.waitForTimeout(3000)
// 现在屏上是第二个编辑器（新的 React mount 链）
await p.evaluate(() => { window.__ev = 0; window.addEventListener('pointerdown', () => window.__ev++, { capture: true, passive: true }) })
const box = await p.evaluate(() => { const r = document.querySelector('.ProseMirror td').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, txt: document.querySelector('.ProseMirror td').textContent } })
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(250)
console.log('第二个真实编辑器窗口:', (await p.evaluate(() => window.__ev)) > 0 ? 'ALIVE ✅' : 'DEAD', 'cell=', box.txt)
await b.close()
