// ★ 死区=表格矩形 374~479（+下溢 6px），段落全活 —— 小文档同样复现！
// 这下好办了：小文档复现 → 快速二分 CSS！
// about:blank + 真实 CSS + 小结构之前活过（probe36）—— 但那时只有表格无
// 前后段落+无 .ProseMirror class 的完整规则。现在直接用「删规则法」：
// 在应用页面注入 style 逐条禁 .ProseMirror 相关表格规则。
// 首要嫌疑：.ProseMirror table .selectedCell::before / .pm-table-handle /
// table td 的 position:relative（selectedCell 规则给 td::before inset:0）
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 100)))
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
await p.evaluate(() => window.__setDocForTest({ meta: { title: 't' }, blocks: [
  { type: 'p', inline: [{ text: '第一段落' }] },
  { type: 'table', rows: [
    [{ inline: [{ text: 'A1' }] }, { inline: [{ text: 'B1' }] }],
    [{ inline: [{ text: 'A2' }] }, { inline: [{ text: 'B2' }] }],
  ] },
  { type: 'p', inline: [{ text: '最后段落' }] },
] }))
await p.waitForTimeout(2200)
const test = async (name, css) => {
  await p.evaluate((c) => {
    const st = document.getElementById('tp') || (() => { const s = document.createElement('style'); s.id = 'tp'; document.head.appendChild(s); return s })()
    st.textContent = c
  }, css)
  await p.waitForTimeout(300)
  await p.evaluate(() => { window.__e = []; window.addEventListener('pointerdown', () => window.__e.push(1), { capture: true, passive: true }) })
  const box = await p.evaluate(() => { const r = document.querySelector('.ProseMirror td').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(200)
  console.log(`${name}:`, (await p.evaluate(() => window.__e.length)) > 0 ? 'ALIVE ✅' : 'DEAD')
}
await test('baseline', '')
await test('去 td position:relative', '.ProseMirror td, .ProseMirror th { position: static !important }')
await test('去 selectedCell::before', '.ProseMirror td.selectedCell::before, .ProseMirror th.selectedCell::before { content: none !important }')
await test('去 pm-table-handle', '.ProseMirror .pm-table-handle { display: none !important }')
await test('去 table position:relative', '.ProseMirror table { position: static !important }')
await test('去 border-collapse', '.ProseMirror table { border-collapse: separate !important }')
await test('去 tableWrapper relative', '.ProseMirror .tableWrapper { position: static !important }')
await b.close()
