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
for (const sn of [5, 6, 15]) {
  const cur = await p.evaluate(() => parseInt((document.body.textContent.match(/#(\d+)\s*\/\s*16/) || ['1'])[1]))
  const key = sn > cur ? 'ArrowRight' : 'ArrowLeft'
  for (let i = 0; i < Math.abs(sn - cur); i++) { await p.keyboard.press(key); await p.waitForTimeout(250) }
  await p.waitForTimeout(700)
  // 定位主画布：页面中最大的【可点击编辑区】。找含最多 clip-path 且带文本框的 808px 容器；若无则用窗口中心区域
  const box = await p.evaluate(() => {
    const host = [...document.querySelectorAll('div')]
      .filter(d => { const r = d.getBoundingClientRect(); return r.width >= 780 && r.width <= 830 && r.height > 400 && d.querySelectorAll('[style*="clip-path"], [contenteditable]').length > 0 })
      .sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0]
    if (host) { const r = host.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, found: true } }
    return { found: false }
  })
  if (!box.found) {
    console.log(`slide${sn}: 未找到主画布容器（缩略图模式）—— 检查视图切换`)
    await p.screenshot({ path: `/tmp/r32_w${sn}.png` })
    continue
  }
  await p.screenshot({ path: `/tmp/r32_c${sn}.png`, clip: { x: box.x, y: box.y, width: box.w, height: box.h } })
  const analysis = execSync(`python3 -c "
from PIL import Image
im = Image.open('/tmp/r32_c${sn}.png').convert('RGB')
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
  console.log(`slide${sn}: 主画布 ${Math.round(box.w)}x${Math.round(box.h)} 主题绿占比 ${analysis}% ${Number(analysis) > 1 ? '✓' : '✗'}`)
}
await b.close()
