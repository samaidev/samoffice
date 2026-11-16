// 新父包裹死（PM DOMObserver 立即把结构改回：parentCls=ProseMirror —— 
// box 被移走了，wrapper 直接挂回 PM —— 变回了「父不变」形态）。
// A/D 的活 = 父是 body（PM 管不着，结构保持）。
// ◆ 机理拼图完成：PM dom 内 wrapper + Chromium 粘滞 hit-test 缓存。
// 务实修复方向：**不与 PM 对抗 —— 让 wrapper 内部某个元素「新创建」**：
// 在 D 实验里活的其实是整棵 wrapper。试试只【替换 table 元素】/
// 只【替换 tbody】（保留 wrapper）→ 若活 → 在 DocTableView.update 里
// 重建 table/tbody 即可（PM 不管理 wrapper 的内部结构 —— NodeView 自己的）
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 100)))
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
const clickTd = async () => {
  await p.evaluate(() => { window.__ev = 0; window.addEventListener('pointerdown', () => window.__ev++, { capture: true, passive: true }) })
  const box = await p.evaluate(() => { const r = document.querySelector('.ProseMirror td').getBoundingClientRect(); return { x: r.x + r.width * 0.7, y: r.y + r.height * 0.5 } })
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(280)
  return (await p.evaluate(() => window.__ev)) > 0
}
console.log('baseline:', await clickTd() ? 'ALIVE' : 'DEAD')
// 替换 tbody（内容整体换新节点）
await p.evaluate(() => {
  const tb = document.querySelector('.ProseMirror tbody')
  const clone = tb.cloneNode(true)
  tb.parentElement.replaceChild(clone, tb)
})
await p.waitForTimeout(500)
console.log('替换 tbody:', await clickTd() ? 'ALIVE ✅' : 'DEAD')
await b.close()
