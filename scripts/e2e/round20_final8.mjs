// 表格整个 300-700 视口带全死（文档 y≈9957 处）—— 表格位置的【绝对文档坐标】
// 决定死活。9957 —— 接近但未到 16384。真正的边界在哪？
// 测试：同一文档【删掉前面部分内容】让表格在不同绝对位置（造不同深度的文档），
// 找死区随绝对位置的变化：
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

// 用【前置空段落】把表格垫到不同绝对深度：pad = N 个空段
async function testAtDepth(padCount) {
  const pads = Array.from({ length: padCount }, () => ({ inline: [{ content: 'x' }], style: '正文' }))
  const doc = { ...j.document, blocks: [...pads, blocks[tableIdx]] }
  await p.evaluate(d => window.__setDocForTest(d), doc)
  await p.waitForTimeout(2200)
  await p.evaluate(() => {
    window.__hit = -1
    if (!window.__mdHooked) { window.__mdHooked = true; window.addEventListener('mousedown', () => { window.__hit = 1 }, true) }
    const sc = document.querySelector('.flex-1.overflow-auto')
    const td = document.querySelector('.ProseMirror table td')
    const scRect = sc.getBoundingClientRect()
    const tdTop = td.getBoundingClientRect().top
    sc.scrollTop += tdTop - scRect.top - 350
  })
  await p.waitForTimeout(1200)
  const box = await p.evaluate(() => {
    const td = document.querySelector('.ProseMirror table td')
    const r = td.getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), top: Math.round(r.top) }
  })
  await p.evaluate(() => { window.__hit = -1 })
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(180)
  const hit = await p.evaluate(() => window.__hit)
  const docY = await p.evaluate(() => Math.round(document.querySelector('.ProseMirror table td').getBoundingClientRect().top + document.querySelector('.flex-1.overflow-auto').scrollTop))
  return { docY, hit: hit >= 0 }
}

for (const pad of [0, 10, 20, 40, 80, 160]) {
  const { docY, hit } = await testAtDepth(pad)
  console.log(`垫${pad}段(文档y=${docY}): ${hit ? '✓' : '✗死区'}`)
}
await b.close()
