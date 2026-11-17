// 文字位置错位：真相标题在中央（40-48%），sam 在顶部（3-10%）。
// 检查第 1 页 shapes 的坐标（UDM EMU → 画布 px）：
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
  const r = canvas.getBoundingClientRect()
  // 画布内文本形状位置
  const shapes = [...canvas.querySelectorAll('div[style*=left]')].map(el => {
    const er = el.getBoundingClientRect()
    return {
      x: Math.round((er.x - r.x) / r.width * 100), y: Math.round((er.y - r.y) / r.height * 100),
      w: Math.round(er.width / r.width * 100), h: Math.round(er.height / r.height * 100),
      text: (el.textContent || '').slice(0, 20),
    }
  }).filter(s => s.w > 5 && s.h > 3)
  return { shapes }
})
console.log('形状位置(%画布):', JSON.stringify(st.shapes, null, 1))
await b.close()
