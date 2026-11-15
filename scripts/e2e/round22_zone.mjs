// 点击死区范围判定：滚动到表格区，逐元素隐藏找出罪魁
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
// 取表格上方段落原始 doc 坐标 + 滚动
const prep = await p.evaluate(() => {
  const pm = window.__pmView
  let tpos = -1
  pm.state.doc.descendants((n, p2) => { if (tpos < 0 && n.type.name === 'table') tpos = p2; return tpos < 0 })
  let before = null, pos = 0
  pm.state.doc.forEach(n => {
    if (!before && n.type.name === 'paragraph' && pos < tpos && n.textContent.trim().length > 4) {
      const el = pm.nodeDOM(pos)
      const r2 = el.getBoundingClientRect()
      before = { docTop: r2.y + (document.querySelector('.flex-1.overflow-auto')?.scrollTop || 0), text: n.textContent.slice(0, 10) }
    }
    pos += n.nodeSize
  })
  return before
})
console.log('表格上方段落 docTop:', Math.round(prep.docTop), prep.text)
await p.evaluate(t => { const sc = document.querySelector('.flex-1.overflow-auto'); if (sc) sc.scrollTo({ top: t - 200 }) }, prep.docTop)
await p.waitForTimeout(900)

const getParaPt = () => p.evaluate(() => {
  const pm = window.__pmView
  let tpos = -1
  pm.state.doc.descendants((n, p2) => { if (tpos < 0 && n.type.name === 'table') tpos = p2; return tpos < 0 })
  let el = null, pos = 0
  pm.state.doc.forEach(n => {
    if (!el && n.type.name === 'paragraph' && pos < tpos && n.textContent.trim().length > 4) el = pm.nodeDOM(pos)
    pos += n.nodeSize
  })
  const r2 = el.getBoundingClientRect()
  return { x: r2.x + 80, y: r2.y + r2.height / 2 }
})
const testClick = async (label) => {
  const pt = await getParaPt()
  if (pt.y < 40 || pt.y > 860) { console.log(label + ': 段落已出视口 y=' + Math.round(pt.y)); return null }
  await p.mouse.click(pt.x, pt.y)
  await p.waitForTimeout(350)
  const f = await p.evaluate(() => window.__pmView.hasFocus())
  console.log(label + ': focus=' + f, f ? 'OK' : 'FAIL')
  return f
}
await testClick('基线（滚动到表格区）')
// 实验A：隐藏所有公式节点
await p.evaluate(() => document.querySelectorAll('.sam-math').forEach(n => n.style.display = 'none'))
await testClick('隐藏公式后')
await p.evaluate(() => document.querySelectorAll('.sam-math').forEach(n => n.style.display = ''))
// 实验B：隐藏所有 tableWrapper
await p.evaluate(() => document.querySelectorAll('.tableWrapper').forEach(n => n.style.display = 'none'))
await testClick('隐藏表格后')
await p.evaluate(() => document.querySelectorAll('.tableWrapper').forEach(n => n.style.display = ''))
// 实验C：隐藏所有 pg-brk 装饰（置 pointer-events:none 不改布局）
await p.evaluate(() => {
  const css = document.createElement('style')
  css.id = 'test-no-deco'
  css.textContent = '.pg-brk, .pg-brk-row, .pg-brk-cell { pointer-events: none !important; }'
  document.head.appendChild(css)
})
await testClick('装饰 pointer-events:none 后')
await p.evaluate(() => document.getElementById('test-no-deco')?.remove())
// 实验D：KaTeX 内部样式 reset（.katex 被移除 display）
await p.evaluate(() => document.querySelectorAll('.katex-display').forEach(n => n.style.display = 'inline'))
await testClick('katex-display 改 inline 后')
await b.close()
