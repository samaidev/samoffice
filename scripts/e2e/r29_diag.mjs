import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 200)))
p.on('console', m => { if (m.type() === 'error') console.log('CERR:', m.text().slice(0, 150)) })
p.setDefaultTimeout(30000)
await p.goto(BASE + '/?r=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(2000)
await p.evaluate(async () => {
  const r = await fetch('/upload-test.pptx')
  const buf = await r.arrayBuffer()
  const file = new File([buf], 'test.pptx', { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })
  const dt = new DataTransfer()
  dt.items.add(file)
  document.querySelector('#root > div').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
})
await p.waitForTimeout(7000)
const st = await p.evaluate(() => {
  const canvas = [...document.querySelectorAll('div')].find(d => (d.className || '').toString().includes('bg-white shadow-xl'))
  const pager = (document.body.textContent || '').match(/\d+ \/ \d+/)?.[0]
  const all808 = [...document.querySelectorAll('div')].filter(d => Math.round(d.getBoundingClientRect().width) === 808).map(d => ({ h: Math.round(d.getBoundingClientRect().height), cls: (d.className || '').toString().slice(0, 30) }))
  return { canvasFound: !!canvas, pager, all808: all808.slice(0, 4), slideEls: document.querySelectorAll('[class*=slide]').length }
})
console.log(JSON.stringify(st, null, 1))
await b.close()
