import { chromium } from 'playwright'
import { execSync } from 'child_process'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 120)))
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
// 键盘到 slide5（4 次）
for (let i = 0; i < 4; i++) { await p.keyboard.press('ArrowRight'); await p.waitForTimeout(200) }
await p.waitForTimeout(800)
// 主画布：宽 808 容器（放宽查找：找含 clip-path 最多的中型容器）
const box = await p.evaluate(() => {
  const cands = [...document.querySelectorAll('div')]
    .filter(d => { const r = d.getBoundingClientRect(); return r.width >= 760 && r.width <= 860 && r.height > 380 })
    .sort((a, b) => b.querySelectorAll('[style*="clip-path"]').length - a.querySelectorAll('[style*="clip-path"]').length)
  if (!cands.length) return null
  const r = cands[0].getBoundingClientRect()
  return { x: r.x, y: r.y, w: r.width, h: r.height, clips: cands[0].querySelectorAll('[style*="clip-path"]').length }
})
console.log('slide5 画布:', JSON.stringify(box))
if (box && box.clips > 0) {
  await p.screenshot({ path: '/tmp/r32_s5c.png', clip: { x: box.x, y: box.y, width: box.w, height: box.h } })
  const pct = execSync(`python3 -c "
from PIL import Image
im = Image.open('/tmp/r32_s5c.png').convert('RGB')
w, h = im.size
px = im.load()
green = total = 0
for y in range(0, h, 2):
    for x in range(0, w, 2):
        r, g, b2 = px[x, y]
        if abs(r-165) < 35 and abs(g-181) < 35 and abs(b2-146) < 35: green += 1
        total += 1
print(f'{green/total*100:.2f}')
"`).toString().trim()
  console.log(`slide5 主画布主题绿占比 ${pct}% ${Number(pct) > 3 ? '✓ SmartArt 可见' : '✗'}`)
} else {
  console.log('slide5: 无画布容器 —— 用全屏截图兜底检查')
  await p.screenshot({ path: '/tmp/r32_s5full.png' })
}
await b.close()
