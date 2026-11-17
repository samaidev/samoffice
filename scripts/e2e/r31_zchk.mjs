import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 120)))
p.on('console', m => { if (m.text().includes('PG')) console.log('LOG:', m.text().slice(0, 100)) })
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
const state = () => p.evaluate(() => {
  const pm = document.querySelector('.ProseMirror')
  const lbs = [...pm.querySelectorAll('.pg-linebreak')]
  const hook = typeof window.__pgRecompute
  return { hook, lbCount: lbs.length, mts: lbs.slice(0, 3).map(l => l.style.marginTop), docZoom: window.__docZoom }
})
console.log('zoom 前:', JSON.stringify(await state()))
// 键盘 Ctrl+= 触发 zoom（3195 行 keydown 处理器）
await p.keyboard.press('Control+=')
await p.waitForTimeout(1500)
console.log('zoom 后:', JSON.stringify(await state()))
// 手动调 hook 看是否重算
await p.evaluate(() => window.__pgRecompute?.())
await p.waitForTimeout(1000)
console.log('手动 hook:', JSON.stringify(await state()))
await b.close()
