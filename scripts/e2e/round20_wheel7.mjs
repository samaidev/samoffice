// inline 样式无关。剩最后嫌疑：DocTableView 的 NodeView 结构本身 ——
// PM 用 NodeView 时 contentDOM(tbody) 的位置对事件路由至关重要。
// 破坏性实验：把 table 从 NodeView wrapper 里【移出】（破坏 NodeView 归属），
// 看点击是否恢复 —— 如果恢复 = PM NodeView 与 Chromium 交互的 bug：
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
await p.evaluate(d => window.__setDocForTest(d), j.document)
await p.waitForTimeout(2500)
await p.evaluate(() => {
  window.__hit = -1
  window.addEventListener('mousedown', () => { window.__hit = 1 }, true)
})
await p.evaluate(() => {
  const sc = document.querySelector('.flex-1.overflow-auto')
  const td = document.querySelector('.ProseMirror table td')
  const scRect = sc.getBoundingClientRect()
  const tdTop = td.getBoundingClientRect().top
  sc.scrollTop += tdTop - scRect.top - 300
})
await p.waitForTimeout(2000)
const tryClick = async (label) => {
  await p.evaluate(() => { window.__hit = -1 })
  const box = await p.evaluate(() => {
    const td = document.querySelector('.ProseMirror table td')
    const r = td.getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  })
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(200)
  const hit = await p.evaluate(() => window.__hit)
  console.log(`${label}: ${hit >= 0 ? '✓' : '✗'}`)
  return hit >= 0
}
await tryClick('基线')
// 实验1：替换 NodeView 的 table 为纯 HTML clone（脱离 PM 管理，保留位置）
await p.evaluate(() => {
  const t = document.querySelector('.ProseMirror table')
  const clone = t.cloneNode(true)
  t.parentElement.replaceChild(clone, t)
})
await p.waitForTimeout(400)
if (await tryClick('clone 替换后')) console.log('>>> PM NodeView 管理是罪魁（clone 可点）')
// 实验2：若 clone 还不行 —— 试试把表格挪到 scroller 外
await b.close()
