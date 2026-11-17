import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
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
await p.waitForTimeout(6000)
await p.evaluate(() => { document.querySelector('[data-testid=ribbon-tab-view]')?.click() })
await p.waitForTimeout(400)
await p.evaluate(() => { const btns = [...document.querySelectorAll('button')]; btns.find(x => x.offsetParent !== null && (x.textContent || '').includes('Play'))?.click() })
await p.waitForTimeout(2500)
await p.screenshot({ path: '/tmp/r30_fullscreen.png' })
// 顶部 10px 蓝色来源：检查放映层顶部的元素
const probe = await p.evaluate(() => {
  const layer = document.querySelector('.fixed.inset-0')
  const out = []
  for (let y = 5; y <= 25; y += 10) {
    const el = document.elementFromPoint(680, y)
    out.push({ y, el: el ? el.tagName + '.' + (el.className || '').toString().slice(0, 40) : null })
  }
  return { z50: !!layer, points: out }
})
console.log(JSON.stringify(probe, null, 1))
await b.close()
