import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
await p.goto(BASE + '/?r=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(2500)
await p.evaluate(async () => {
  const r = await fetch('/upload-test.docx')
  const buf = await r.arrayBuffer()
  const file = new File([buf], 'upload-test.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
  const dt = new DataTransfer()
  dt.items.add(file)
  document.querySelector('#root > div').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
})
await p.waitForTimeout(9000)
await p.evaluate(() => { document.querySelector('table').scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(800)
// 1) 装捕获监听：document 捕获阶段记录事件路径
const trace = await p.evaluate(() => {
  window.__md = []
  document.addEventListener('mousedown', (e) => {
    window.__md.push('doc-capture:' + (e.target).tagName + '.' + ((e.target).className || '').toString().slice(0, 20) + ' defaultPrevented=' + e.defaultPrevented)
  }, true)
  document.addEventListener('mousedown', (e) => {
    window.__md.push('doc-bubble:' + (e.target).tagName + ' defaultPrevented=' + e.defaultPrevented)
  }, false)
  // 2) 检查 td 的编辑性继承
  const cell = document.querySelectorAll('table td, table th')[20]
  const chain = []
  let cur = cell
  for (let i = 0; i < 5 && cur; i++) {
    chain.push(cur.tagName + '[' + (cur.getAttribute && cur.getAttribute('contenteditable') || '-') + ']')
    cur = cur.parentElement
  }
  // 3) PM handleDOMEvents 探针：看 PM 是否处理 mousedown
  const pm = document.querySelector('.ProseMirror')
  return { chain, pmEditable: pm?.getAttribute('contenteditable'), userSelect: getComputedStyle(cell).userSelect.slice(0, 12), pointerEvents: getComputedStyle(cell).pointerEvents }
})
console.log('pre-click:', JSON.stringify(trace))
const box = await p.evaluate(() => {
  const cell = document.querySelectorAll('table td, table th')[20]
  const r = cell.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(400)
const after = await p.evaluate(() => ({ md: window.__md, activeEl: document.activeElement?.tagName }))
console.log('after click:', JSON.stringify(after))
await b.close()
