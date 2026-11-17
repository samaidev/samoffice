// round30 最终对比：编辑态画布 clip vs 放映态全屏截图缩放到 808x606 → 像素对比
import { chromium } from 'playwright'
import fs from 'fs'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 120)))
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
// 1) 编辑态：画布 clip
const c1 = await p.evaluate(() => {
  const c = [...document.querySelectorAll('div')].find(d => (d.className || '').toString().includes('bg-white shadow-xl'))
  const r = c.getBoundingClientRect()
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
})
if (!c1 || !c1.w) { console.log('canvas lost'); await b.close(); process.exit(1) }
await p.screenshot({ path: '/tmp/r30f_edit.png', clip: { x: c1.x, y: c1.y, width: c1.w, height: c1.h } })
console.log('编辑态 clip:', JSON.stringify(c1))
// 2) 放映态：全屏截图（幻灯片 scale 居中占满/接近全屏）
await p.evaluate(() => { document.querySelector('[data-testid=ribbon-tab-view]')?.click() })
await p.waitForTimeout(400)
await p.evaluate(() => { const btns = [...document.querySelectorAll('button')]; btns.find(x => x.offsetParent !== null && (x.textContent || '').includes('Play'))?.click() })
await p.waitForTimeout(1500)
const presInfo = await p.evaluate(() => {
  const layer = document.querySelector('.fixed.inset-0')
  if (!layer) return { err: 'no presenting layer' }
  // 幻灯片容器（1200x900 或视口内最大）
  const cands = [...layer.querySelectorAll('div')].map(d => d.getBoundingClientRect()).filter(r => r.width > 500 && r.height > 400)
  const r = cands.sort((a, b2) => b2.width * b2.height - a.width * a.height)[0]
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
})
console.log('放映态幻灯片视觉框:', JSON.stringify(presInfo))
if (presInfo.w) {
  await p.screenshot({ path: '/tmp/r30f_pres.png', clip: { x: presInfo.x, y: presInfo.y, width: presInfo.w, height: presInfo.h } })
} else { console.log('pres layer missing:', JSON.stringify(presInfo)) }
await b.close()
console.log('DONE')
