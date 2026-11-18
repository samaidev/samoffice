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
const cell = () => p.evaluate(() => {
  const c = document.querySelectorAll('table td, table th')[20]
  const r = c.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
const test = async (label) => {
  await p.evaluate(() => { window.__md = null })
  const box = await cell()
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(250)
  const md = await p.evaluate(() => window.__md)
  console.log(label, md || '✗丢失')
  return !!md
}
await test('基线:')
// 1) 强制 wrapper 重绘：改宽度
await p.evaluate(() => {
  const w = document.querySelector('.tableWrapper')
  w.style.width = '90%'
})
await p.waitForTimeout(300)
await test('改宽90%:')
await p.evaluate(() => {
  const w = document.querySelector('.tableWrapper')
  w.style.width = ''
})
await p.waitForTimeout(300)
// 2) display none → block（完全重建渲染）
await p.evaluate(() => {
  const w = document.querySelector('.tableWrapper')
  w.style.display = 'none'
})
await p.waitForTimeout(300)
await p.evaluate(() => {
  const w = document.querySelector('.tableWrapper')
  w.style.display = ''
})
await p.waitForTimeout(300)
await test('display重建:')
// 3) zoom 祖先（794px 层）加 transform 再去掉
await p.evaluate(() => {
  const w = document.querySelector('.tableWrapper')
  let z794 = w.parentElement
  for (let i = 0; i < 4; i++) { if (z794.style.width === '794px') break; z794 = z794.parentElement }
  z794.style.transform = 'translateZ(0)'
  setTimeout(() => { z794.style.transform = '' }, 100)
})
await p.waitForTimeout(500)
await test('zoom层扰动:')
await b.close()
