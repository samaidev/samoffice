// 表格点击失败深挖：隐藏表格之外的一切，表格还失败吗？
// + 关键对照：点击【表格正上方段落】是否正常（区分"表格内"还是"整个区域"）
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

const locate = () => p.evaluate(() => {
  const pm = window.__pmView
  let tpos = -1
  pm.state.doc.descendants((n, p2) => { if (tpos < 0 && n.type.name === 'table') tpos = p2; return tpos < 0 })
  const el = pm.nodeDOM(tpos)
  const r2 = el.getBoundingClientRect()
  // 表格上方最近段落
  let ppos = -1
  pm.state.doc.descendants((n, p3) => {
    if (ppos < 0 && n.type.name === 'paragraph' && p3 < tpos && n.textContent.trim()) ppos = p3
    return ppos < 0
  })
  const pel = ppos >= 0 ? pm.nodeDOM(ppos) : null
  const pr = pel?.getBoundingClientRect?.()
  return { tbl: { x: r2.x + 60, y: r2.y + 25, top: r2.y }, para: pr ? { x: pr.x + 60, y: pr.y + pr.height / 2 } : null }
})

let loc = await locate()
// 滚动表格到视口
await p.evaluate(y => { const sc = document.querySelector('.flex-1.overflow-auto'); if (sc) sc.scrollTo({ top: Math.max(0, y - 260) }) }, loc.tbl.top)
await p.waitForTimeout(600)
loc = await locate()

// 对照组：表格上方段落
await p.mouse.click(loc.para.x, loc.para.y)
await p.waitForTimeout(350)
const paraFocus = await p.evaluate(() => window.__pmView.hasFocus())
console.log('表格上方段落点击: focus=' + paraFocus, paraFocus ? 'OK' : 'FAIL')

// 表格
await p.mouse.click(loc.tbl.x, loc.tbl.y)
await p.waitForTimeout(350)
const tblFocus = await p.evaluate(() => window.__pmView.hasFocus())
console.log('表格内点击: focus=' + tblFocus, tblFocus ? 'OK' : 'FAIL')

// ★ 实验：z-index 全清（纸页层 zIndex:0 + 内容层 z-index:1 —— 
// round22_hit 显示有 matrix transform 的 DIV，可能是 paper 层）
await p.evaluate(() => {
  document.querySelectorAll('div').forEach(d => {
    const s = getComputedStyle(d)
    if (s.position === 'absolute' || s.position === 'fixed') {
      d.style.zIndex = 'auto'
      if (s.pointerEvents === 'none') d.style.pointerEvents = 'none'
      else d.style.pointerEvents = 'auto'
    }
  })
})
await p.waitForTimeout(300)
await p.mouse.click(loc.tbl.x, loc.tbl.y)
await p.waitForTimeout(350)
const tblFocus2 = await p.evaluate(() => window.__pmView.hasFocus())
console.log('zIndex归一后表格点击: focus=' + tblFocus2, tblFocus2 ? 'OK（层叠顺序问题）' : 'FAIL')

// ★ 实验2：body 直插探针 —— 点击位置 elementFromPoint 现在返回什么
const hit2 = await p.evaluate(t => {
  const el = document.elementFromPoint(t.x, t.y)
  return el ? { tag: el.tagName, cls: String(el.className).slice(0, 40), ce: el.isContentEditable } : null
}, loc.tbl)
console.log('elementFromPoint(表格内):', JSON.stringify(hit2))
await b.close()
