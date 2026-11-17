// DOM 说文字可见但截图全白 —— 唯一解释：截图时和 DOM 探针时【状态不同】
// 或有【上层遮挡】（白色 overlay 盖住画布 —— 比如选中文本框时编辑器
// 画白色遮罩）。检查 elementFromPoint 画布中心命中谁：
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
await p.waitForTimeout(8000)
const st = await p.evaluate(() => {
  const out = { points: [] }
  const canvas = [...document.querySelectorAll('div')].find(d => d.className?.toString().includes('bg-white shadow-xl'))
  const r = canvas.getBoundingClientRect()
  // 标题中心（画布内 40,13 727x108 → 中心 ≈ 403,67 相对画布）
  for (const [dx, dy, label] of [[404, 67, '标题'], [647, 515, '副标题'], [400, 300, '画布中央']]) {
    const x = r.x + dx, y = r.y + dy
    const el = document.elementFromPoint(x, y)
    out.points.push({ label, x: Math.round(x), y: Math.round(y), hit: el ? el.tagName + '.' + (el.className || '').toString().slice(0, 30) : 'null', text: (el?.textContent || '').slice(0, 15) })
  }
  // 画布的 z-index / transform 上下文
  const cs = getComputedStyle(canvas)
  out.canvas = { z: cs.zIndex, transform: cs.transform, opacity: cs.opacity, anim: cs.animationName }
  return out
})
console.log(JSON.stringify(st, null, 1))
await b.close()
