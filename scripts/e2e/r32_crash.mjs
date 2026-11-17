import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 300)))
p.on('console', m => { if (m.type() === 'error') console.log('CONSOLE-ERR:', m.text().slice(0, 300)) })
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
await p.evaluate(() => { const items = [...document.querySelectorAll('li, [class*=thumb], button')].filter(x => x.offsetParent !== null && /^6$/.test((x.textContent || '').trim())); if (items.length) items[items.length - 1].click() })
await p.waitForTimeout(2500)
const st = await p.evaluate(() => {
  const body = (document.body.textContent || '').replace(/\s+/g, ' ')
  return {
    pageInd: (body.match(/(\d+)\s*\/\s*16/) || [])[0],
    hasError: /error|Error|崩溃|出错/.test(body),
    clipShapes: document.querySelectorAll('[style*="clip-path"]').length,
    bodyLen: body.length,
    tail: body.slice(-200),
  }
})
console.log(JSON.stringify(st, null, 1))
await p.screenshot({ path: '/tmp/r32_slide6.png' })
await b.close()
