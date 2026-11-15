// 表格 HTML 本身无问题！罪魁在应用 CSS。二分法找 CSS 规则：
// 在真实应用里逐条【禁用候选 CSS】测试。候选：index.css 中所有含
// table/td/th/ProseMirror 的规则 + 全局 * 规则。
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
// 逐个禁用【样式表】
const sheets = await p.evaluate(() => Array.from(document.styleSheets).map((s, i) => ({ i, href: (s.href || 'inline').split('/').pop(), rules: (() => { try { return s.cssRules.length } catch { return -1 } })() })))
console.log('样式表:', JSON.stringify(sheets))
// 先全禁再看（确认 CSS 是罪魁）
await p.evaluate(() => {
  document.querySelectorAll('style, link[rel=stylesheet]').forEach(n => n.disabled = true)
})
await p.waitForTimeout(400)
if (await tryClick('禁用全部样式后')) console.log('>>> CSS 确认是罪魁，逐表恢复定位')
await b.close()
