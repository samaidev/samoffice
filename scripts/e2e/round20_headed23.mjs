// ★★★ 诡异但重要：scrollTop=0 时 MISS，300/1000 时 HIT！
// 与之前矛盾？—— 不。之前测试都是【表格滚到 y≈515】的（scrollTop 很大）且 MISS。
// 但这次 scrollTop=300/1000 都 HIT……
// 区别：这次是【单行表格文档】！之前的完整文档表格是 9 行。
// 所以：短表格（1行）滚 300 可点；之前测的 9 行表（原样局部文档）滚到 515 不可点。
// ……等等 headed21 的 '仅表头1行' 也是 MISS —— 那次滚到 tdTop-300。
// 这次 scrollTop=300 也 HIT —— 但那表格顶部在哪？滚动 300 后 td 应该在
// 384-300=84 附近 —— 我点击的 box.y 是【滚动后】算的。
// 
// 总结规律候选：td 在视口的 y<400 可点，>500 不可点？不 —— 顶部 y=410 MISS！
// 300 后 y≈84 HIT；1000 后（表格滚出视口？box3.y 是滚动后算的 —— 若表格已在
// 视口上方，box3.y 会是负数，playwright 点击负 y 会自动滚回 —— HIT。
// 所以真正稳定的规律：**点击发生时若需要 Playwright 自动滚动 → HIT；
// 点击点已在视口内 → MISS?!** 但 y=410 那次也没自动滚（在视口内）→ MISS；
// y=84 也在视口内 → HIT。
// 混乱！重新精确对照：scrollTop=0 时 td y=410 MISS；scrollTop=300 时 td y=84 HIT。
// 唯一差异：scrollTop 值本身 + td 视口位置。
// 再精细扫描：不同 scrollTop 下的点击结果
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const b = await chromium.launch({ args: ['--no-sandbox'], headless: false })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(15000)
await p.goto('http://localhost:18400', { waitUntil: 'networkidle' })
await p.evaluate(() => localStorage.setItem('samoffice_theme', 'light'))
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
const buf = fs.readFileSync(DOC)
const form = new FormData()
form.append('file', new Blob([buf]), 'contract.docx')
const r = await fetch('http://localhost:18400/api/doc/open', { method: 'POST', body: form })
const j = await r.json()
const blocks = j.document.blocks
const tableIdx = blocks.findIndex(bl => bl.rows)
const oneRow = { ...j.document, blocks: [{ ...blocks[tableIdx], rows: [blocks[tableIdx].rows[0]] }] }
await p.evaluate(d => window.__setDocForTest(d), oneRow)
await p.waitForTimeout(2500)
await p.evaluate(() => {
  window.__hit = -1
  if (!window.__mdHooked) { window.__mdHooked = true; window.addEventListener('mousedown', () => { window.__hit = 1 }, true) }
})
const out = []
for (const st of [0, 50, 100, 150, 200, 250, 300, 400]) {
  await p.evaluate(v => { document.querySelector('.flex-1.overflow-auto').scrollTop = v }, st)
  await p.waitForTimeout(500)
  const box = await p.evaluate(() => {
    const td = document.querySelector('.ProseMirror table td')
    const r = td.getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  })
  if (box.y < 0 || box.y > 880) { out.push(`st=${st}:跳过(y=${box.y})`); continue }
  await p.evaluate(() => { window.__hit = -1 })
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(200)
  const hit = await p.evaluate(() => window.__hit)
  out.push(`st=${st}(tdY=${box.y}):${hit >= 0 ? '✓' : '✗'}`)
}
console.log(out.join(' '))
await b.close()
