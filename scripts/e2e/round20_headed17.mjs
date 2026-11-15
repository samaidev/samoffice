// 最小页面不复现 —— 应用特有。系统排除到只剩一个未查的组件：
// sam-ruler（标尺）！标尺在编辑器顶部，width 100% position sticky/absolute
// 且可能向下【超出标尺区延伸覆盖】。查它的几何：
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
  // 遍历【视口内覆盖 (309,541)】的所有元素 —— 包括 pe=none 的（找非 none 的）
  const els = document.elementsFromPoint(309, 541)
  // elementsFromPoint 已经按 z 排序 —— 全部打出来：
  const stack = els.map(e => {
    const s = getComputedStyle(e)
    return `${e.tagName}.${(e.className?.toString().slice(0, 22) || '')}|pe=${s.pointerEvents}|z=${s.zIndex}|pos=${s.position}`
  })
  // 检查 sam-ruler
  const ruler = document.querySelector('.sam-ruler')
  const rr = ruler?.getBoundingClientRect()
  return { stack: stack.slice(0, 10), ruler: rr ? { y: Math.round(rr.y), h: Math.round(rr.height), pe: getComputedStyle(ruler).pointerEvents } : null }
})
console.log('(309,541) 完整命中栈:')
info.stack.forEach(s => console.log(' ', s))
console.log('标尺:', JSON.stringify(info.ruler))
await b.close()
