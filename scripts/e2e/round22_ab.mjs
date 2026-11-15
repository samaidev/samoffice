// CSS 特性逐项关闭 A/B 测试
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
await p.evaluate(() => { const sc = window.__pmView.dom.closest('[class*="overflow"]'); sc.scrollTo({ top: 10230 }) })
await p.waitForTimeout(2000)

const clickTest = async (label) => {
  // 点表格后段落（之前死区点）
  const pt = await p.evaluate(() => {
    for (const el of document.querySelectorAll('.ProseMirror p')) {
      const r = el.getBoundingClientRect()
      if (r.y > 400 && r.y < 700 && el.textContent.trim().length > 5) return { x: r.x + 40, y: r.y + r.height / 2 }
    }
    return null
  })
  if (!pt) { console.log(label + ': 目标丢失'); return null }
  await p.evaluate(() => { window.__mlog = []; document.addEventListener('mousedown', () => window.__mlog.push('md'), { once: true, capture: true }) })
  await p.mouse.click(pt.x, pt.y)
  await p.waitForTimeout(350)
  const got = await p.evaluate(() => window.__mlog.length > 0)
  console.log(label + ': 事件=' + (got ? 'OK' : '死区'))
  return got
}
await clickTest('基线')
// A: 关闭所有 transform（行回原位）
await p.evaluate(() => { document.querySelectorAll('.pg-brk-row').forEach(tr => tr.style.transform = 'none') })
await p.waitForTimeout(300)
await clickTest('A 关行位移')
await p.evaluate(() => { document.querySelectorAll('.pg-brk-row').forEach(tr => tr.style.transform = '') })
// B: 关闭 wrapper margin-bottom
await p.evaluate(() => { document.querySelectorAll('.pg-brk-table').forEach(d => d.style.marginBottom = '0px') })
await p.waitForTimeout(300)
await clickTest('B 关补高margin')
await p.evaluate(() => { document.querySelectorAll('.pg-brk-table').forEach(d => d.style.marginBottom = '') })
// C: 关闭 border-separate（回 collapse）
await p.evaluate(() => { const s = document.createElement('style'); s.id = 'ab-c'; s.textContent = '.pg-brk-table > table { border-collapse: collapse !important }'; document.head.appendChild(s) })
await p.waitForTimeout(300)
await clickTest('C 关separate边框')
await p.evaluate(() => document.getElementById('ab-c')?.remove())
// D: 关闭 table-layout:fixed
await p.evaluate(() => { document.querySelectorAll('table.pm-table').forEach(t => t.style.tableLayout = 'auto') })
await p.waitForTimeout(300)
await clickTest('D 关fixed布局')
await p.evaluate(() => { document.querySelectorAll('table.pm-table').forEach(t => t.style.tableLayout = '') })
// E: 隐藏表格 wrapper（整表消失）
await p.evaluate(() => { document.querySelectorAll('.pg-brk-table').forEach(d => d.style.display = 'none') })
await p.waitForTimeout(300)
await clickTest('E 隐藏断行表格')
await p.evaluate(() => { document.querySelectorAll('.pg-brk-table').forEach(d => d.style.display = '') })
// F: 全部效果叠加关（A+B+C+D+E 一起）
await p.evaluate(() => {
  document.querySelectorAll('.pg-brk-row').forEach(tr => tr.style.transform = 'none')
  document.querySelectorAll('.pg-brk-table').forEach(d => { d.style.marginBottom = '0px' })
  const s = document.createElement('style'); s.id = 'ab-f'; s.textContent = '.pg-brk-table > table { border-collapse: collapse !important }'; document.head.appendChild(s)
  document.querySelectorAll('table.pm-table').forEach(t => t.style.tableLayout = 'auto')
})
await p.waitForTimeout(300)
await clickTest('F 全关')
await b.close()
