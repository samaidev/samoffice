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
  document.addEventListener('mousedown', (e) => { window.__md = 'got@' + e.target.tagName + '#' + (e.target.id || (typeof e.target.className === 'string' ? e.target.className.split(' ')[0] : '')) }, true)
  // body 级 fixed 原生 table
  const t1 = document.createElement('table')
  t1.id = 'r34-body-tbl'
  t1.innerHTML = '<tbody><tr><td>body-table</td></tr></tbody>'
  Object.assign(t1.style, { position: 'fixed', left: '60px', top: '150px', width: '220px', height: '60px', background: '#fdd', border: '2px solid #900', zIndex: 3000 })
  document.body.appendChild(t1)
  // body 级 fixed div（对照）
  const d1 = document.createElement('div')
  d1.id = 'r34-body-div'
  d1.textContent = 'body-div'
  Object.assign(d1.style, { position: 'fixed', left: '60px', top: '250px', width: '220px', height: '60px', background: '#dfd', border: '2px solid #090', zIndex: 3000 })
  document.body.appendChild(d1)
})
await p.waitForTimeout(500)
await p.mouse.click(170, 180)
await p.waitForTimeout(250)
const r1 = await p.evaluate(() => window.__md)
await p.mouse.click(170, 280)
await p.waitForTimeout(250)
const r2 = await p.evaluate(() => window.__md)
console.log('body fixed table:', r1 || '✗丢失')
console.log('body fixed div:  ', r2 || '✗丢失')
// 再点一个 PM 段落（回归确认 PM 本身活着）
await p.evaluate(() => { window.__md = null })
const para = await p.evaluate(() => {
  const ps = document.querySelectorAll('.ProseMirror p')
  const r = ps[0].getBoundingClientRect()
  return { x: r.x + 50, y: r.y + 10 }
})
await p.mouse.click(para.x, para.y)
await p.waitForTimeout(250)
const r3 = await p.evaluate(() => window.__md)
console.log('PM 首段落:       ', r3 || '✗丢失')
await b.close()
