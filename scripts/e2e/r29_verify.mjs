// round29 验证：①死循环消失 ②画布背景 #8B8E83 生效 ③文字可见（非白像素）
import { chromium } from 'playwright'
import fs from 'fs'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
let loopWarns = 0
p.on('console', m => { if (m.text().includes('Maximum update depth')) loopWarns++ })
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 150)))
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
console.log('死循环警告:', loopWarns, loopWarns === 0 ? '✓ 消失' : '❌ 仍存在')
const st = await p.evaluate(() => {
  const canvas = [...document.querySelectorAll('div')].find(d => d.className?.toString().includes('bg-white shadow-xl'))
  if (!canvas) return { err: 'no canvas' }
  const cs = getComputedStyle(canvas)
  const r = canvas.getBoundingClientRect()
  return {
    canvasBg: cs.backgroundColor,
    rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    bgClass: canvas.className.includes('bg-white') ? '有bg-white类(可能与内联bg冲突)' : '无',
  }
})
console.log('画布状态:', JSON.stringify(st, null, 1))
// 截图画布区域
await p.screenshot({ path: '/tmp/r29_canvas.png' })
console.log('截图 OK')
await b.close()
