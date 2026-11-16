// ★ 注意 papers: i=8 顶=54 底=1177 (pe=none) —— 视口正中的一张纸。
// 而分页正确的话表格应该在第 8~9 页。  这纸的 parentElement pe=none。
// 但段落能点 —— 都在同一纸上！
// 停止发散。回到【reparent 实验】最可靠的结论：挂到 overflow-auto([7]) 内有事件，
// 挂到它的兄弟层([9] = flex flex-col h-full 根)没事件。reparent 到 [9] 时 wrapper
// 追加在 DocumentEditor 根的最后 —— 那里有「比较/分屏的右栏」！flex row！
// 等等——d9 的 style 是 position:relative，子元素 [2] 是空 DIV。
// 停! 换个被我忽略的角度：**表格后面有个 position:absolute 的巨大元素**：
// watermark！DocumentEditor 3758 行：watermark 有 zIndex:5, pointerEvents:'none',
// top 50% left 50% rotate(-30deg) fontSize 72px whiteSpace nowrap —— 
// 「巨大 nowrap 文本」在旋转后包围盒可以横跨全屏，pe=none 无碍……
// 但 checkChain 里的 "DIV. pe=none z=0" 是 sheetsLayer。
// 快速验证：把 sheetsLayer 与 watermark 逐一 display:none 再点击
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(800)
const buf = fs.readFileSync(DOC)
const form = new FormData()
form.append('file', new Blob([buf]), 'contract.docx')
const r = await fetch(BASE + '/api/doc/open', { method: 'POST', body: form })
const j = await r.json()
await p.evaluate(d => window.__setDocForTest(d), j.document)
await p.waitForTimeout(3500)
await p.evaluate(() => { [...document.querySelectorAll('.ProseMirror td')][2].scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(1200)

const tryHide = async (name, selector) => {
  const ok = await p.evaluate((sel) => {
    const els = [...document.querySelectorAll(sel)]
    if (!els.length) return false
    window.__h2 = els.map(e => { const d = e.style.display; e.style.display = 'none'; return { e, d } })
    return true
  }, selector)
  if (!ok) { console.log(`${name}: no element`); return }
  await p.waitForTimeout(300)
  await p.evaluate(() => { window.__ev = []; window.addEventListener('pointerdown', e => window.__ev.push(e.target.tagName), true) })
  const box = await p.evaluate(() => {
    const r = [...document.querySelectorAll('.ProseMirror td')][2].getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(200)
  const ev = await p.evaluate(() => window.__ev)
  console.log(`${name} hidden → events:`, JSON.stringify(ev))
  await p.evaluate(() => { for (const { e, d } of window.__h2) e.style.display = d })
  await p.waitForTimeout(200)
}
// 候选隐藏对象（按嫌疑排序）
await tryHide('sheetsLayer(纸页层容器)', '.flex-1.overflow-auto [style*="pointer-events: none"]')
await tryHide('所有 .pg-paper', '.pg-paper')
await tryHide('水印', '[style*="rotate(-30deg)"]')
await tryHide('行号层', '.overflow-auto [style*="zIndex: 2"], .overflow-auto [style*="z-index: 2"]')
await b.close()
