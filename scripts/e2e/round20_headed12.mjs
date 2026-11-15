// 这些 ce=false 都在 PM 内部（装饰性，正常）。但之前 probe10 显示 PM 的父 DIV
// 计算值 read-only —— 只有祖先有 false 才会这样。列表里第一个含 PM 的 false
// 元素没出现（都不含 PM）……但计算值从哪来？—— 【contenteditable="false" 的
// 装饰元素不可能是祖先】。除非 computed 的 read-only 来自 .ProseMirror 自身？
// probe10 chain: DIV.ProseMirror ce=true → 上一个 DIV ce=read-only。
// 谁是 ProseMirror 的直接父元素？editorRef div（pm-host）！它没有 ce 属性
// （前面 grep 无 contenteditable 写入）…… 但 computed 是 read-only？!
// 那 pm-host 之上还有 DIV（3960 行外的 wrapper）—— 查 pm-host 的父链
// 每一层的显式 contenteditable：
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
const chain = await p.evaluate(() => {
  const pm = document.querySelector('.ProseMirror')
  const out = []
  let n = pm.parentElement
  while (n && out.length < 5) {
    const cs = getComputedStyle(n)
    out.push({
      tag: n.tagName, cls: (n.className?.toString().slice(0, 28) || ''), key: n.getAttribute('data-key') || '',
      ceAttr: n.getAttribute('contenteditable'),
      ceComputed: cs.contentEditable,
      webkit: cs.webkitUserModify,
    })
    n = n.parentElement
  }
  return out
})
console.log(JSON.stringify(chain, null, 1))
await b.close()
