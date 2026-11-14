// 无 iframe。换一个前所未有的角度 —— 也许问题根本不在"点击"，而在
// 【mouse.click 的 move 阶段触发了 hover 逻辑让表格滚动/位置变化】，
// down 时坐标已经指向【表格外的空白页边距】（不可交互区，浏览器丢弃）。
// 之前验证过 move 后命中 SPAN —— 但那次是 move 后立即查。
// 现在监测 down 前一刻（用 mouse.down 前的 rAF）表格位置：
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const b = await chromium.launch({ args: ['--no-sandbox'], headless: false })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(15000)
const cmsgs = []
p.on('console', m => cmsgs.push(m.text().slice(0, 120)))
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
  const sc = document.querySelector('.flex-1.overflow-auto')
  const td = document.querySelector('.ProseMirror table td')
  const scRect = sc.getBoundingClientRect()
  const tdTop = td.getBoundingClientRect().top
  sc.scrollTop += tdTop - scRect.top - 300
})
await p.waitForTimeout(2500)
// 高频采样：每 50ms 记录表格位置 + 指针位置命中元素，持续 2.5s
await p.evaluate(() => {
  window.__samples = []
  setInterval(() => {
    const td = document.querySelector('.ProseMirror table td')
    if (!td) { window.__samples.push('no-td'); return }
    const r = td.getBoundingClientRect()
    const el = document.elementFromPoint(309, 541)
    window.__samples.push(`tdY=${Math.round(r.y)} hit=${el ? el.tagName + (el.closest('td') ? 'TD' : '') : 'null'}`)
  }, 50)
})
const box = { x: 309, y: 541 }
await p.mouse.move(box.x - 30, box.y - 30) // 从远处移入
await p.waitForTimeout(300)
await p.mouse.move(box.x, box.y, { steps: 5 })
await p.waitForTimeout(200)
await p.mouse.down()
await p.waitForTimeout(100)
await p.mouse.up()
await p.waitForTimeout(300)
const samples = await p.evaluate(() => window.__samples.slice(-25))
console.log('采样（move/down 前后）:')
samples.forEach(s => console.log(' ', s))
await b.close()
