// 死区=表格矩形。表格 NodeView（DocTableView）创建的 table 有
// inline style：border-collapse: collapse + margin + align。
// 加上 schema toDOM 的属性。关键是表格 NodeView 的 this.table 上有什么。
// 以及 wrapper div.tableWrapper。dump 全部 inline 样式 + 逐项移除测试：
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
// dump inline 样式
const dump = await p.evaluate(() => {
  const t = document.querySelector('.ProseMirror table')
  const w = t.closest('.tableWrapper')
  return {
    tableStyle: t.getAttribute('style'),
    tableAttrs: Array.from(t.attributes).map(a => a.name + '=' + a.value.slice(0, 40)),
    wrapStyle: w.getAttribute('style'),
    wrapAttrs: Array.from(w.attributes).map(a => a.name),
  }
})
console.log(JSON.stringify(dump, null, 1).slice(0, 1200))
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
// 逐项剥离：table inline style 全清
await p.evaluate(() => { document.querySelector('.ProseMirror table').removeAttribute('style') })
await p.waitForTimeout(300)
if (await tryClick('清 table inline style')) console.log('>>> table style 是罪魁')
// wrapper style 清
await p.evaluate(() => { document.querySelector('.tableWrapper').removeAttribute('style') })
await p.waitForTimeout(300)
if (await tryClick('清 wrapper style')) console.log('>>> wrapper style 是罪魁')
await b.close()
