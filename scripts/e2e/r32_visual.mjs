import { chromium } from 'playwright'
import { execSync } from 'child_process'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
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
// 逐页截图 + 程序化像素分析（SmartArt 主题色 #A5B592 出现率）
for (const sn of [5, 6, 7, 15]) {
  const cur = await p.evaluate(() => parseInt((document.body.textContent.match(/#(\d+)\s*\/\s*16/) || ['1'])[1]))
  const key = sn > cur ? 'ArrowRight' : 'ArrowLeft'
  for (let i = 0; i < Math.abs(sn - cur); i++) { await p.keyboard.press(key); await p.waitForTimeout(250) }
  await p.waitForTimeout(700)
  // 主画布区域截图（808 宽画布居中 —— 直接全窗口截取）
  await p.screenshot({ path: `/tmp/r32_v${sn}.png` })
  // 像素分析：主题绿色 A5B592 容差匹配
  const analysis = execSync(`python3 -c "
from PIL import Image
im = Image.open('/tmp/r32_v${sn}.png').convert('RGB')
w, h = im.size
px = im.load()
green = total = 0
for y in range(0, h, 3):
    for x in range(0, w, 3):
        r, g, b2 = px[x, y]
        if abs(r-165) < 30 and abs(g-181) < 30 and abs(b2-146) < 30: green += 1
        total += 1
print(f'{green} {total} {green/total*100:.2f}')
"`).toString().trim().split(' ')
  const pct = (Number(analysis[2])).toFixed(2)
  console.log(`slide${sn}: 主题绿色像素占比 ${pct}% ${Number(pct) > 0.5 ? '✓ SmartArt 可见' : '✗ 疑似缺失'}`)
}
await b.close()
console.log('DONE')
