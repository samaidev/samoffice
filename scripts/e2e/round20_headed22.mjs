// 一行表格也 MISS！那问题不在表格结构 —— 在【表格所在的滚动位置】！
// 所有测试都是把表格滚到 y≈515。而"段落点击成功"的那些试验，
// 段落在 y≈455。唯一系统性差异：**滚动量**。
// 单表格文档很短，为什么也要滚 300px？因为 pm-host 有 padding docMargins.top
// + 分页纸页高度 —— 表格永远在 9000+px 深处！
// 决定性测试：单行表格 + 用 scrollTo(0)（表格就在顶部）点击：
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
// 滚动到最顶
await p.evaluate(() => {
  const sc = document.querySelector('.flex-1.overflow-auto')
  sc.scrollTop = 0
  window.__hit = -1
  if (!window.__mdHooked) { window.__mdHooked = true; window.addEventListener('mousedown', () => { window.__hit = 1 }, true) }
})
await p.waitForTimeout(1500)
const box = await p.evaluate(() => {
  const td = document.querySelector('.ProseMirror table td')
  const r = td.getBoundingClientRect()
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), top: Math.round(r.top) }
})
console.log('顶部表格位置:', JSON.stringify(box))
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(300)
const hit = await p.evaluate(() => window.__hit)
console.log('scrollTop=0 点击:', hit >= 0 ? '✓ HIT' : '✗ MISS')
// 现在滚 300 再点
await p.evaluate(() => { document.querySelector('.flex-1.overflow-auto').scrollTop = 300 })
await p.waitForTimeout(600)
const box2 = await p.evaluate(() => {
  const td = document.querySelector('.ProseMirror table td')
  const r = td.getBoundingClientRect()
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
})
await p.evaluate(() => { window.__hit = -1 })
await p.mouse.click(box2.x, box2.y)
await p.waitForTimeout(300)
const hit2 = await p.evaluate(() => window.__hit)
console.log('scrollTop=300 点击:', hit2 >= 0 ? '✓ HIT' : '✗ MISS')
// 滚 1000 再点
await p.evaluate(() => { document.querySelector('.flex-1.overflow-auto').scrollTop = 1000 })
await p.waitForTimeout(600)
const box3 = await p.evaluate(() => {
  const td = document.querySelector('.ProseMirror table td')
  const r = td.getBoundingClientRect()
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
})
await p.evaluate(() => { window.__hit = -1 })
await p.mouse.click(box3.x, box3.y)
await p.waitForTimeout(300)
const hit3 = await p.evaluate(() => window.__hit)
console.log('scrollTop=1000 点击:', hit3 >= 0 ? '✓ HIT' : '✗ MISS')
await b.close()
