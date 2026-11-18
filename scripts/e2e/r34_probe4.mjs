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
// A) scrollIntoView 路径
await p.evaluate(() => { document.querySelector('table').scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(800)
const a = await p.evaluate(() => {
  const sc = document.querySelector('.overflow-auto')
  const body = document.scrollingElement
  const cell = document.querySelectorAll('table td, table th')[20]
  const r = cell.getBoundingClientRect()
  const x = r.x + r.width / 2, y = r.y + r.height / 2
  const hit = document.elementFromPoint(x, y)
  return {
    scrollerTop: Math.round(sc.scrollTop), bodyTop: Math.round(body.scrollTop),
    hit: hit ? hit.tagName : 'NULL', cellY: Math.round(r.y),
  }
})
console.log('A scrollIntoView:', JSON.stringify(a))
// B) 手动 scrollTop 路径
await p.evaluate(() => {
  const sc = document.querySelector('.overflow-auto')
  sc.scrollTop = 0; document.scrollingElement.scrollTop = 0
})
await p.waitForTimeout(300)
await p.evaluate(() => {
  const sc = document.querySelector('.overflow-auto')
  const t = document.querySelector('table')
  sc.scrollTop = t.getBoundingClientRect().top + sc.scrollTop - 300
})
await p.waitForTimeout(800)
const c = await p.evaluate(() => {
  const sc = document.querySelector('.overflow-auto')
  const cell = document.querySelectorAll('table td, table th')[20]
  const r = cell.getBoundingClientRect()
  const x = r.x + r.width / 2, y = r.y + r.height / 2
  const hit = document.elementFromPoint(x, y)
  return { scrollerTop: Math.round(sc.scrollTop), bodyTop: Math.round(document.scrollingElement.scrollTop), hit: hit ? hit.tagName : 'NULL', cellY: Math.round(r.y) }
})
console.log('B manual scrollTop:', JSON.stringify(c))
await b.close()
