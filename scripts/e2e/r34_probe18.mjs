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
await p.evaluate(() => { document.querySelector('table').scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(800)
const ctr = () => p.evaluate(() => {
  const c = document.querySelectorAll('table td, table th')[20]
  const r = c.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
const click = async (label) => {
  await p.evaluate(() => { window.__md = null })
  const box = await ctr()
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(250)
  const md = await p.evaluate(() => window.__md)
  console.log(label, md || '✗丢失')
}
// 1) 清空 table 全部 style + class
await p.evaluate(() => {
  const t = document.querySelector('table')
  t.removeAttribute('style'); t.removeAttribute('class')
  t.querySelectorAll('*').forEach(el => { if (el.getAttribute('style')) el.setAttribute('style', '') })
})
await p.waitForTimeout(300)
await click('1 清空table样式:')
// 2) 清空 wrapper 样式
await p.evaluate(() => {
  const w = document.querySelector('.tableWrapper')
  w.removeAttribute('style')
})
await p.waitForTimeout(300)
await click('2 清空wrapper:')
// 3) 核弹：wrapper 挪到 body（脱离 PM）—— 若活，说明 PM 内部有鬼
const moved = await p.evaluate(() => {
  const w = document.querySelector('.tableWrapper')
  if (!w) return false
  Object.assign(w.style, { position: 'fixed', left: '100px', top: '400px', zIndex: 2500, background: '#fff', border: '3px solid red' })
  document.body.appendChild(w)
  return true
})
if (moved) {
  await p.waitForTimeout(400)
  await p.mouse.click(250, 450)
  await p.waitForTimeout(250)
  const r3 = await p.evaluate(() => window.__md)
  console.log('3 wrapper挪到body:', r3 || '✗丢失（PM 认领的 DOM 挪走仍死 → 合成层鬼影）')
}
await b.close()
