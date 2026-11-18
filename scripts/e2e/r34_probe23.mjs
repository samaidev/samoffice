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
const cell = async () => p.evaluate(() => {
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
}
await test('基线:')
// 剥 z-index:1 层（chain[3]：PM 上数第 3 个祖先）
await p.evaluate(() => {
  const wrap = document.querySelector('.tableWrapper')
  const chain = []
  let cur = wrap.parentElement
  while (cur && cur !== document.body) { chain.push(cur); cur = cur.parentElement }
  const z1 = chain[3]
  window.__z1saved = z1.getAttribute('style')
  z1.style.zIndex = 'auto'
  z1.style.position = 'static'
})
await p.waitForTimeout(300)
await test('剥z1层后:')
// 恢复
await p.evaluate(() => {
  const wrap = document.querySelector('.tableWrapper')
  const chain = []
  let cur = wrap.parentElement
  while (cur && cur !== document.body) { chain.push(cur); cur = cur.parentElement }
  chain[3].setAttribute('style', window.__z1saved || '')
})
await p.waitForTimeout(300)
await test('恢复z1后:')
await b.close()
