// posAtCoords 诊断：表格区段落坐标 → PM 位置换算
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const b = await chromium.launch({ args: ['--no-sandbox'], headless: false })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(25000)
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
await p.waitForTimeout(3500)
await p.evaluate(() => { const sc = document.querySelector('.flex-1.overflow-auto'); sc.scrollTo({ top: 10230 }) })
await p.waitForTimeout(2000)
const diag = await p.evaluate(() => {
  const pm = window.__pmView
  // 找表格区上方段落
  let target = null
  for (const el of document.querySelectorAll('.ProseMirror p')) {
    const r = el.getBoundingClientRect()
    if (r.y > 150 && r.y < 400 && el.textContent.trim().length > 5) { target = { x: r.x + 80, y: r.y + r.height / 2, text: el.textContent.slice(0, 8) }; break }
  }
  const pos = pm.posAtCoords({ left: target.x, top: target.y })
  // 对照：首屏段落（滚回顶部）
  return { target, posAtCoords: pos ? { pos: pos.pos, inside: pos.inside } : null }
})
console.log('表格区段落 posAtCoords:', JSON.stringify(diag))
// 滚回顶部对照
await p.evaluate(() => { const sc = document.querySelector('.flex-1.overflow-auto'); sc.scrollTo({ top: 0 }) })
await p.waitForTimeout(1500)
const diag2 = await p.evaluate(() => {
  const pm = window.__pmView
  let target = null
  for (const el of document.querySelectorAll('.ProseMirror p')) {
    const r = el.getBoundingClientRect()
    if (r.y > 300 && r.y < 500 && el.textContent.trim().length > 5) { target = { x: r.x + 80, y: r.y + r.height / 2, text: el.textContent.slice(0, 8) }; break }
  }
  const pos = pm.posAtCoords({ left: target.x, top: target.y })
  return { target, posAtCoords: pos ? { pos: pos.pos, inside: pos.inside } : null }
})
console.log('滚回顶部 posAtCoords:', JSON.stringify(diag2))
// 再滚到表格区验证（往返后）
await p.evaluate(() => { const sc = document.querySelector('.flex-1.overflow-auto'); sc.scrollTo({ top: 10230 }) })
await p.waitForTimeout(2000)
const diag3 = await p.evaluate(() => {
  const pm = window.__pmView
  let target = null
  for (const el of document.querySelectorAll('.ProseMirror p')) {
    const r = el.getBoundingClientRect()
    if (r.y > 150 && r.y < 400 && el.textContent.trim().length > 5) { target = { x: r.x + 80, y: r.y + r.height / 2, text: el.textContent.slice(0, 8) }; break }
  }
  const pos = pm.posAtCoords({ left: target.x, top: target.y })
  return { target, posAtCoords: pos ? { pos: pos.pos, inside: pos.inside } : null }
})
console.log('往返后表格区 posAtCoords:', JSON.stringify(diag3))
await b.close()
