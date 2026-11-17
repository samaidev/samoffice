import { chromium } from 'playwright'
import fs from 'fs'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 100)))
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
// 画布探测：优先 bg-white shadow-xl；退化用 808 宽容器
const findCanvas = () => p.evaluate(() => {
  let c = [...document.querySelectorAll('div')].find(d => (d.className || '').toString().includes('bg-white shadow-xl'))
  if (!c) c = [...document.querySelectorAll('div')].find(d => { const r = d.getBoundingClientRect(); return Math.round(r.width) === 808 && r.height > 500 })
  if (!c) return null
  const r = c.getBoundingClientRect()
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
})
fs.rmSync('/tmp/ppt_sam_pages', { recursive: true, force: true })
fs.mkdirSync('/tmp/ppt_sam_pages', { recursive: true })
await p.evaluate(() => { document.querySelector('[data-testid=ribbon-tab-view]')?.click() })
await p.waitForTimeout(600)
const clickNext = () => p.evaluate(() => {
  const btns = [...document.querySelectorAll('button')]
  const nb = btns.find(x => x.offsetParent !== null && (x.textContent || '').includes('→') && !(x.textContent || '').includes('Indent'))
  nb?.click()
  return !!nb
})
for (let i = 0; i < 16; i++) {
  const canvas = await findCanvas()
  if (canvas && canvas.w > 100 && canvas.h > 50) {
    await p.screenshot({ path: `/tmp/ppt_sam_pages/p${String(i + 1).padStart(2, '0')}.png`, clip: { x: canvas.x, y: canvas.y, width: canvas.w, height: canvas.h } })
  } else {
    console.log(`页${i + 1} canvas 丢失，跳过`)
  }
  if (i < 15) { await clickNext(); await p.waitForTimeout(550) }
}
console.log('已截图:', fs.readdirSync('/tmp/ppt_sam_pages').length)
await b.close()
