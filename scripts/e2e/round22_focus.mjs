// 严格视口内点击：表格内/表格上邻段落/表格下邻段落
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
const targets = await p.evaluate(() => {
  const pm = window.__pmView
  let tpos = -1
  pm.state.doc.descendants((n, p2) => { if (tpos < 0 && n.type.name === 'table') tpos = p2; return tpos < 0 })
  // 表格前后最近段落（按位置顺序）
  let before = null, after = null
  let pos = 0
  pm.state.doc.forEach(n => {
    if (n.type.name === 'paragraph' && n.textContent.trim().length > 4) {
      const el = pm.nodeDOM(pos)
      const r2 = el?.getBoundingClientRect?.()
      if (r2) {
        const c = { x: r2.x + 80, y: r2.y + r2.height / 2, top: r2.y, text: n.textContent.slice(0, 12) }
        if (pos < tpos) before = c
        else if (!after) after = c
      }
    }
    pos += n.nodeSize
  })
  const tel = pm.nodeDOM(tpos)
  const tr = tel.getBoundingClientRect()
  return { tbl: { x: tr.x + 60, y: tr.y + 25, top: tr.y }, before, after, tpos }
})
console.log('表格 top:', Math.round(targets.tbl.top), '前段:', targets.before?.text, '后段:', targets.after?.text)
// 滚动：表格放到视口中上部
await p.evaluate(y => { const sc = document.querySelector('.flex-1.overflow-auto'); if (sc) sc.scrollTo({ top: Math.max(0, y - 200) }) }, targets.tbl.top)
await p.waitForTimeout(900)
// 重新取坐标（滚动后）
const t2 = await p.evaluate(() => {
  const pm = window.__pmView
  let tpos = -1
  pm.state.doc.descendants((n, p2) => { if (tpos < 0 && n.type.name === 'table') tpos = p2; return tpos < 0 })
  const tel = pm.nodeDOM(tpos)
  const tr = tel.getBoundingClientRect()
  let before = null, after = null, pos = 0
  pm.state.doc.forEach(n => {
    if (n.type.name === 'paragraph' && n.textContent.trim().length > 4) {
      const el = pm.nodeDOM(pos)
      const r2 = el?.getBoundingClientRect?.()
      if (r2 && r2.y > 100 && r2.y < 800) {
        const c = { x: r2.x + 80, y: r2.y + r2.height / 2, text: n.textContent.slice(0, 10) }
        if (pos < tpos) before = c; else if (!after) after = c
      }
    }
    pos += n.nodeSize
  })
  return { tbl: { x: tr.x + 60, y: tr.y + 25 }, before, after, tblInView: tr.y > 100 && tr.y < 700 }
})
console.log('滚动后表格在视口:', t2.tblInView)
const tryClick = async (pt, label) => {
  if (!pt) { console.log(label + ': 无目标'); return }
  if (pt.y < 60 || pt.y > 840) { console.log(label + ': 目标在视口外 y=' + Math.round(pt.y)); return }
  await p.mouse.click(pt.x, pt.y)
  await p.waitForTimeout(400)
  const f = await p.evaluate(() => window.__pmView.hasFocus())
  console.log(label + ': y=' + Math.round(pt.y) + ' focus=' + f, f ? 'OK' : 'FAIL')
}
await tryClick(t2.before, '表格上方段落')
await tryClick(t2.tbl, '表格内')
await tryClick(t2.after, '表格下方段落')
await b.close()
