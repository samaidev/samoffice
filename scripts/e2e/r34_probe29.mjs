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
await p.evaluate(() => {
  window.__md = null
  document.addEventListener('mousedown', (e) => { window.__md = 'got@' + e.target.tagName }, true)
})
// 克隆整个 ProseMirror，fixed 放 body 上方，contenteditable=true
await p.evaluate(() => {
  const pm = document.querySelector('.ProseMirror')
  const clone = pm.cloneNode(true)
  clone.id = 'r34-pm-clone'
  Object.assign(clone.style, { position: 'fixed', left: '50px', top: '60px', width: '500px', height: '300px', overflow: 'scroll', zIndex: 3500, background: '#fff', border: '2px solid blue' })
  document.body.appendChild(clone)
})
await p.waitForTimeout(600)
// 克隆里的表格中心
const box = await p.evaluate(() => {
  const t = document.getElementById('r34-pm-clone').querySelector('table')
  const r = t.getBoundingClientRect()
  return { x: r.x + 40, y: r.y + 30 }
})
await p.evaluate(() => { window.__md = null })
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(250)
const r1 = await p.evaluate(() => window.__md)
console.log('克隆PM(body上,editable):', r1 || '✗丢失')
// 对照：克隆PM contenteditable=false
await p.evaluate(() => { document.getElementById('r34-pm-clone').contentEditable = 'false' })
await p.waitForTimeout(300)
await p.evaluate(() => { window.__md = null })
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(250)
const r2 = await p.evaluate(() => window.__md)
console.log('克隆PM(editable=false):', r2 || '✗丢失')
await b.close()
