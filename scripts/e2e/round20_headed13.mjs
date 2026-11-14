// 无显式 false，全是继承（webkit read-only 只是无 ce 时默认显示）。这正常。
// contenteditable 排除。回到最扎实的实验数据：
//   - 段落点击：事件到、focus 到 —— ✓
//   - 表格点击：事件完全消失 —— ✗
//   - elementFromPoint 表格位置命中 SPAN —— hit-test OK
// Chromium 只在一种情况下丢弃 mousedown：目标在 <select>/插件区，
// 或者【目标元素在不同 document（iframe）】！
// —— 检查 .ProseMirror table 是否在主 document，而事件 target 其实在 iframe？
// 或者 PM 表格区域被 <iframe> 覆盖（不可见）：
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const b = await chromium.launch({ args: ['--no-sandbox'], headless: false })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(15000)
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
const info = await p.evaluate(() => {
  const iframes = document.querySelectorAll('iframe')
  const td = document.querySelector('.ProseMirror table td')
  const r = td.getBoundingClientRect()
  // iframe 们覆盖表格吗
  const cov = Array.from(iframes).filter(f => {
    const fr = f.getBoundingClientRect()
    return r.x + 20 >= fr.x && r.x + 20 <= fr.x + fr.width && r.y + 20 >= fr.y && r.y + 20 <= fr.y + fr.height
  })
  return { iframeCount: iframes.length, covering: cov.length, details: Array.from(iframes).slice(0, 3).map(f => { const fr = f.getBoundingClientRect(); return { src: (f.src || '').slice(0, 30), y: Math.round(fr.y), h: Math.round(fr.height) } }) }
})
console.log(JSON.stringify(info))
await b.close()
