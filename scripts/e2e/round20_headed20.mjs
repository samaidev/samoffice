// handle.click 完成（actionability 检查通过 = Playwright 认为可点）但页面无事件！
// Playwright 的 actionability 用 elementFromPoint —— 与 JS 一致。
// 而 Chromium 原生输入派发用另一套。两套 hit-test 不一致 = Chromium bug，
// 出在【这个页面的某个具体结构】。最小页面不复现。
// 二分法大杀器：把 PM 文档内容【逐半删除】找触发的最小结构：
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'

async function testDoc(p, blocks, label) {
  // 用 __setDocForTest 打开裁剪后的文档，滚到表格，点击，返回是否收到事件
  await p.evaluate(d => window.__setDocForTest(d), blocks)
  await p.waitForTimeout(2200)
  await p.evaluate(() => {
    const sc = document.querySelector('.flex-1.overflow-auto')
    const td = document.querySelector('.ProseMirror table td')
    if (!td) return
    const scRect = sc.getBoundingClientRect()
    const tdTop = td.getBoundingClientRect().top
    sc.scrollTop += tdTop - scRect.top - 300
    window.__hit = -1
    if (!window.__mdHooked) {
      window.__mdHooked = true
      window.addEventListener('mousedown', () => { window.__hit = 1 }, true)
    }
  })
  await p.waitForTimeout(1200)
  const ok = await p.evaluate(() => !!document.querySelector('.ProseMirror table td'))
  if (!ok) return 'NO-TABLE'
  const box = await p.evaluate(() => {
    const td = document.querySelector('.ProseMirror table td')
    const r = td.getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  })
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(250)
  const hit = await p.evaluate(() => window.__hit)
  return hit >= 0 ? 'HIT' : 'MISS'
}

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

console.log('全文档:', await testDoc(p, { ...j.document, blocks }, 'full'))
// 找到含表格的最小前缀：二分块数
const tableIdx = blocks.findIndex(bl => bl.rows)
console.log('表格在块', tableIdx, '/', blocks.length)
// 保留表格前 3 块 + 表格 + 后 2 块
const min = blocks.slice(Math.max(0, tableIdx - 3), tableIdx + 3)
console.log('局部文档:', await testDoc(p, { ...j.document, blocks: min }, 'mini'))
// 只有表格本身
console.log('仅表格:', await testDoc(p, { ...j.document, blocks: [blocks[tableIdx]] }, 'only-table'))
await b.close()
