// ★ 任何深度都死！（甚至 y=384 浅处也死）—— 但【只有表格】的文档
// （无正文/公式）可点（wheel7 前的测试：仅表格 HIT? —— 不，仅表格也 MISS）
// 等等 —— headed21 '仅表头1行' MISS，headed16 最小复现页（非 PM 的原生
// table）HIT。但 headed22 的单行表格 + scrollTop 300/1000 HIT（那时是
// 【单行表+什么样式】？）—— 那个文档只有表格，滚到 300 就 HIT。
// 现在垫段+表格滚到表格处全死 —— 差异：**表格上方有没有内容**！
// 上方内容（公式/段落）→ 死。仅表格 → 滚动后可点。
// 再验证：垫 1 段 vs 0 段（直接表格在顶部不滚动）：
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const b = await chromium.launch({ args: ['--no-sandbox'], headless: false })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(20000)
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

async function testDoc(docBlocks, scroll) {
  await p.evaluate(d => window.__setDocForTest(d), { ...j.document, blocks: docBlocks })
  await p.waitForTimeout(2200)
  await p.evaluate(() => {
    window.__hit = -1
    if (!window.__mdHooked) { window.__mdHooked = true; window.addEventListener('mousedown', () => { window.__hit = 1 }, true) }
  })
  if (scroll > 0) await p.evaluate(v => { document.querySelector('.flex-1.overflow-auto').scrollTop = v }, scroll)
  await p.waitForTimeout(800)
  const box = await p.evaluate(() => {
    const td = document.querySelector('.ProseMirror table td')
    const r = td.getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  })
  if (box.y < 0 || box.y > 880) return '跳过(y=' + box.y + ')'
  await p.evaluate(() => { window.__hit = -1 })
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(180)
  return (await p.evaluate(() => window.__hit)) >= 0 ? '✓' : '✗死区'
}

const tbl = blocks[tableIdx]
console.log('仅表格 不滚:', await testDoc([tbl], 0))
console.log('仅表格 滚300:', await testDoc([tbl], 300))
console.log('表格+1段 不滚:', await testDoc([blocks[0], tbl], 0))
console.log('表格+1段 滚300:', await testDoc([blocks[0], tbl], 300))
console.log('表格+10段 滚300:', await testDoc([...blocks.slice(0, 10), tbl], 300))
await b.close()
