// ★★★★★ 巨大发现：**所有尺寸都 DEAD —— 连 3 段+2 行小表格也点不到！**
// 这不是"大文档"问题，是普遍性 bug！之前真实文档里段落能点、表格不能 —— 
// 那么小文档里段落能点吗？快速对照 —— 如果小文档段落也点不到，问题在
// 「打开文档的方式」(e2e-test.docx)；如果段落能点 → 表格 bug 100% 普遍。
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
await p.waitForTimeout(2500)
const clickAt = async (sel) => {
  await p.evaluate(() => { window.__e = []; window.addEventListener('pointerdown', e => window.__e.push(e.target.tagName), { capture: true, passive: true }) })
  const box = await p.evaluate((s) => {
    const els = [...document.querySelectorAll(s)]
    const el = els[els.length - 1]
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  }, sel)
  if (!box) return 'no-el'
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(250)
  const ev = await p.evaluate(() => window.__e)
  return ev.length ? 'ALIVE(' + ev[0] + ')' : 'DEAD'
}
console.log('最后段落:', await clickAt('.ProseMirror p'))
console.log('第一段落:', await clickAt('.ProseMirror p'))
console.log('表格 td:', await clickAt('.ProseMirror td'))
console.log('表格 wrapper:', await clickAt('.tableWrapper'))
// 全屏点击分布：找死区精确边界
const yScan = await p.evaluate(() => {
  window.__sc = []
  window.addEventListener('pointerdown', e => window.__sc.push(Math.round(e.clientY)), { capture: true, passive: true })
  const w = document.querySelector('.tableWrapper')
  const r = w.getBoundingClientRect()
  return { top: Math.round(r.top), bottom: Math.round(r.bottom), x: Math.round(r.x + r.width / 2) }
})
for (let y = yScan.top - 24; y <= yScan.bottom + 24; y += 6) {
  await p.mouse.click(yScan.x, y)
  await p.waitForTimeout(40)
}
console.log('live ys:', JSON.stringify(await p.evaluate(() => window.__sc)), 'table', yScan.top + '~' + yScan.bottom)
await b.close()
