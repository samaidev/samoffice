// 真实 CSS 也活！→ 问题是「真实文档的表格 DOM」特有结构。
// 关键区别候选：真实表格 td 有 position:relative（CSS selectedCell 用）+ 
// ::before 覆盖 + 表格巨大（36 cells, 487px）+ td 内容含 <p> 带
// 具体样式。把真实表格完整 outerHTML 抠出来，在 about:blank + 真实 CSS
// 环境里复现：
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(800)
const buf = fs.readFileSync(DOC)
const form = new FormData()
form.append('file', new Blob([buf]), 'contract.docx')
const r = await fetch(BASE + '/api/doc/open', { method: 'POST', body: form })
const j = await r.json()
await p.evaluate(d => window.__setDocForTest(d), j.document)
await p.waitForTimeout(3500)
await p.evaluate(() => { [...document.querySelectorAll('.ProseMirror td')][2].scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(1000)
// 抠取真实表格 wrapper 的 outerHTML + PM dom 的完整 class/style
const extract = await p.evaluate(() => {
  const td = [...document.querySelectorAll('.ProseMirror td')][2]
  const wrapper = td.closest('.tableWrapper')
  const pm = window.__pmView.dom
  return {
    wrapperHTML: wrapper.outerHTML.slice(0, 30000),
    pmAttrs: { cls: pm.className, style: pm.getAttribute('style') || '', ce: pm.getAttribute('contenteditable') },
    hostStyle: pm.parentElement.getAttribute('style') || '',
    // wrapper 在 PM 里的前后兄弟（装饰断点）
    prevHTML: wrapper.previousElementSibling?.outerHTML?.slice(0, 400) || '',
    nextHTML: wrapper.nextElementSibling?.outerHTML?.slice(0, 200) || '',
  }
})
fs.writeFileSync('/tmp/r26_extract.json', JSON.stringify(extract))
console.log('extracted. pm:', JSON.stringify(extract.pmAttrs))
console.log('prev sibling:', extract.prevHTML.slice(0, 200))
await b.close()
