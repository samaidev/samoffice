// 二分隔离：①移除所有 sam-math DOM 后表格可点吗？②移除 tableWrapper 样式？
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'

async function clickTable(p, label) {
  const tbl = await p.evaluate(() => {
    const pm = window.__pmView
    let pos = -1
    pm.state.doc.descendants((n, p2) => { if (pos < 0 && n.type.name === 'table') pos = p2; return pos < 0 })
    if (pos < 0) return null
    const el = pm.nodeDOM(pos)
    const r = el.getBoundingClientRect()
    return { x: r.x + 60, y: r.y + 25, inView: r.y > 100 && r.y < 700 }
  })
  if (!tbl) { console.log(label + ': 无表格'); return null }
  if (!tbl.inView) {
    // 滚动表格进入视口中上部
    await p.evaluate(y => { const sc = document.querySelector('.flex-1.overflow-auto'); if (sc) sc.scrollTo({ top: y - 250 }) }, tbl.y)
    await p.waitForTimeout(500)
    const t2 = await p.evaluate(() => {
      const pm = window.__pmView
      let pos = -1
      pm.state.doc.descendants((n, p2) => { if (pos < 0 && n.type.name === 'table') pos = p2; return pos < 0 })
      const el = pm.nodeDOM(pos)
      const r = el.getBoundingClientRect()
      return { x: r.x + 60, y: r.y + 25 }
    })
    Object.assign(tbl, t2)
  }
  await p.mouse.click(tbl.x, tbl.y)
  await p.waitForTimeout(400)
  const focused = await p.evaluate(() => window.__pmView.hasFocus())
  console.log(label + ': focus=' + focused, focused ? 'OK' : 'FAIL')
  return focused
}

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
// 基线
await clickTable(p, '基线')
// 实验 1：隐藏所有 .sam-math
await p.evaluate(() => { document.querySelectorAll('.sam-math').forEach(n => (n.style.display = 'none')) })
await p.waitForTimeout(300)
await clickTable(p, '隐藏公式后')
await p.evaluate(() => { document.querySelectorAll('.sam-math').forEach(n => (n.style.display = '')) })
await p.waitForTimeout(300)
// 实验 2：隐藏分页纸页层
await p.evaluate(() => { document.querySelectorAll('.pg-paper, [class*="pg-"]').forEach(n => (n.style.display = 'none')) })
await p.waitForTimeout(300)
await clickTable(p, '隐藏纸页层后')
await p.evaluate(() => { document.querySelectorAll('.pg-paper, [class*="pg-"]').forEach(n => (n.style.display = '')) })
// 实验 3：移除 pm-table 的 table-layout:fixed
await p.evaluate(() => { document.querySelectorAll('table.pm-table').forEach(t => (t.style.tableLayout = '')) })
await p.waitForTimeout(300)
await clickTable(p, '去掉 fixed 布局后')
await b.close()
