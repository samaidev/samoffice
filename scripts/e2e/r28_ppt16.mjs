// ★★ 808x606 纯白 —— 但之前 DOM 探针明明显示画布里有 shapes！
//（canvasHTML 有绝对定位 div、left:512px 等）
// 可能性：shapes 存在但【透明/不可见】（fill 空、文字白色）—— 
// 或 clip 截到的容器不是真正画布（animate-fade 容器 vs 内层）。
// 直接元素级检查：画布里每个 shape 的 computed 样式：
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
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
await p.waitForTimeout(6000)
const st = await p.evaluate(() => {
  const canvas = [...document.querySelectorAll('div')].find(d => d.className?.toString().includes('bg-white shadow-xl'))
  if (!canvas) return { err: 'no canvas' }
  const r = canvas.getBoundingClientRect()
  // 画布内所有可见元素
  const shapes = [...canvas.querySelectorAll('div[class*=absolute], [style*=absolute]')].slice(0, 12).map(el => {
    const cs = getComputedStyle(el)
    const er = el.getBoundingClientRect()
    return {
      pos: `${Math.round(er.x - r.x)},${Math.round(er.y - r.y)} ${Math.round(er.width)}x${Math.round(er.height)}`,
      visible: cs.visibility, opacity: cs.opacity, display: cs.display,
      hasText: (el.textContent || '').length,
      color: cs.color, bg: cs.backgroundColor,
    }
  })
  return { canvasRect: { x: r.x, y: r.y, w: r.width, h: r.height }, shapeCount: canvas.querySelectorAll('div[class*=absolute], [style*=absolute]').length, shapes }
})
console.log(JSON.stringify(st, null, 1))
await b.close()
