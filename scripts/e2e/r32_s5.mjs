import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
await p.goto(BASE + '/?r=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(2500)
await p.evaluate(async () => {
  const r = await fetch('/upload-test.pptx')
  const buf = await r.arrayBuffer()
  const file = new File([buf], 'upload-test.pptx', { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })
  const dt = new DataTransfer()
  dt.items.add(file)
  document.querySelector('#root > div').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
})
await p.waitForTimeout(9000)
for (let i = 0; i < 4; i++) { await p.keyboard.press('ArrowRight'); await p.waitForTimeout(300) }
await p.waitForTimeout(800)
const out = await p.evaluate(() => {
  const hosts = [...document.querySelectorAll('div')]
    .filter(d => d.querySelectorAll('[style*="clip-path"]').length > 0)
    .map(d => { const r = d.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), clips: d.querySelectorAll('[style*="clip-path"]').length, txt: (d.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40) } })
  return hosts
})
console.log(JSON.stringify(out, null, 1))
await b.close()
