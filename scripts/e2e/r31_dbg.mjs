import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
await p.goto(BASE + '/?r=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(2000)
await p.evaluate(async () => {
  const r = await fetch('/test31.docx')
  const buf = await r.arrayBuffer()
  const file = new File([buf], 'test31.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
  const dt = new DataTransfer()
  dt.items.add(file)
  document.querySelector('#root > div').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
})
await p.waitForTimeout(6000)
await p.keyboard.down('Control'); await p.keyboard.press('='); await p.keyboard.up('Control')
await p.waitForTimeout(2500)
const out = await p.evaluate(() => {
  const dbg = (window.__r31dbg || []).filter(x => x.k >= 170 && x.k <= 177)
  return { count: (window.__r31dbg || []).length, tail: dbg }
})
console.log(JSON.stringify(out, null, 1))
await b.close()
