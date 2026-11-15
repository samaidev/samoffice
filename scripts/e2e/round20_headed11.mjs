// 谁写了 contenteditable=false 到 pm-host 的父链？之前 probe 显示
// DIV.ProseMirror ce=true（PM 设置）但父 DIV ce=read-only。
// React 不会写 —— 是 PM 自己？还是浏览器对「非编辑容器内的 editable」的
// 计算？computed ce 显示 read-only 意味着【显式 contenteditable=false】
// 存在于某个祖先。搜运行时：
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
const info = await p.evaluate(() => {
  // 全文档找显式 contenteditable=false 的元素
  const all = document.querySelectorAll('[contenteditable="false"]')
  return Array.from(all).slice(0, 8).map(e => {
    const r = e.getBoundingClientRect()
    return `${e.tagName}.${(e.className?.toString().slice(0, 25) || '')} y=${Math.round(r.y)} h=${Math.round(r.height)} 含PM=${!!e.querySelector('.ProseMirror')}`
  })
})
console.log('显式 ce=false 的元素:')
info.forEach(i => console.log(' ', i))
await b.close()
