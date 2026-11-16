// 注意到大量重复事件（点击一次 push 多次 —— 因为累积监听器），但模式清晰：
// 挂在 [7] overflow-auto / [8] DIV / [10][11] overflow-hidden 下都有事件（TABLE），
// 挂在 [9] flex flex-col h-full 下无（HTML）！
// [9] 的 parent 是 [10] overflow-hidden。即：**在 overflow-hidden 容器里、
// 直接子级为 flex flex-col h-full 的结构下，事件丢失**。
// 这层 DIV 是什么？查它的 DOM 结构和内联样式。
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
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
await p.waitForTimeout(1200)
const info = await p.evaluate(() => {
  const td = [...document.querySelectorAll('.ProseMirror td')][2]
  let el = td.closest('table').parentElement
  const arr = []
  while (el && el !== document.body) { arr.push(el); el = el.parentElement }
  const d9 = arr[9] // flex flex-col h-full
  const d8 = arr[8] // DIV
  const d10 = arr[10]
  const dump = (e) => ({
    tag: e.tagName, cls: (e.className || '').toString().slice(0, 40),
    style: (e.getAttribute('style') || '').slice(0, 200),
    childCount: e.children.length,
    childTags: [...e.children].map(c => c.tagName + '.' + (c.className || '').toString().slice(0, 15)).slice(0, 6),
  })
  return { d8: dump(d8), d9: dump(d9), d10: dump(d10) }
})
console.log(JSON.stringify(info, null, 1))
await b.close()
