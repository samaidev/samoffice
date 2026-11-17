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
// 逐页跳转并截主画布（808x606 容器）做像素分析
for (const sn of [5, 6, 7, 15]) {
  const cur = await p.evaluate(() => parseInt((document.body.textContent.match(/#(\d+)\s*\/\s*16/) || ['1'])[1]))
  const key = sn > cur ? 'ArrowRight' : 'ArrowLeft'
  for (let i = 0; i < Math.abs(sn - cur); i++) { await p.keyboard.press(key); await p.waitForTimeout(280) }
  await p.waitForTimeout(900)
  const box = await p.evaluate(() => {
    const host = [...document.querySelectorAll('div')]
      .filter(d => { const r = d.getBoundingClientRect(); return Math.abs(r.width - 808) < 3 && r.height > 500 })
      .sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height)[0]
    if (!host) return null
    const r = host.getBoundingClientRect()
    const txt = (host.textContent || '').replace(/\s+/g, '')
    return { x: r.x, y: r.y, w: r.width, h: r.height, txt }
  })
  if (!box) { console.log(`slide${sn}: ✗ 无画布`); continue }
  await p.screenshot({ path: `/tmp/r32_f${sn}.png`, clip: { x: box.x, y: box.y, width: box.w, height: box.h } })
  const pct = execSync(`python3 -c "
from PIL import Image
im = Image.open('/tmp/r32_f${sn}.png').convert('RGB')
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
  const kw = { 5: '传统出租车', 6: '滴滴', 7: '用户数', 15: 'IPO' }[sn]
  const hasTxt = box.txt.includes(kw)
  console.log(`slide${sn}: 主题绿 ${pct}% 文本[${kw}]${hasTxt ? '✓' : '✗'} ${Number(pct) > 2 && hasTxt ? '✓ PASS' : '✗'}`)
}
await b.close()
console.log('ALL DONE')
