// ★★★ 决定性发现：PM 的【父容器】是 contenteditable=read-only（ce 继承被切断）！
// DIV.ProseMirror ce=true，但它的父 DIV 是 ce=read-only（显式设置 contenteditable="false"）！
// Chromium 对 contenteditable 容器【嵌套结构】的事件路由有特殊行为：
// 外层 read-only + 内层 true —— 鼠标事件在 read-only 区域会被特殊处理。
// 但段落点击为什么行？！段落和表格在同一个 ProseMirror 里……
// 等等 —— 段落也是 PM 内的。除非 PM 顶层 div 之上的只读父层不一样。
// 查 ProseMirror 的父链中谁设置了 contenteditable=false —— 这层 DIV 是啥：
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
  const pm = document.querySelector('.ProseMirror')
  const chain = []
  let n = pm.parentElement
  while (n && chain.length < 6) {
    chain.push({
      tag: n.tagName, cls: (n.className?.toString().slice(0, 30) || ''),
      ceAttr: n.getAttribute('contenteditable'),
      id: n.id || '',
      // 位置和尺寸
      r: (() => { const rr = n.getBoundingClientRect(); return { y: Math.round(rr.y), h: Math.round(rr.height) } })(),
    })
    n = n.parentElement
  }
  return chain
})
console.log(JSON.stringify(info, null, 1))
await b.close()
