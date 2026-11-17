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
await p.waitForTimeout(6000)
await p.evaluate(() => { document.querySelector('[data-testid=ribbon-tab-view]')?.click() })
await p.waitForTimeout(500)
for (let k = 0; k < 3; k++) {
  await p.evaluate(() => { const btns = [...document.querySelectorAll('button')]; btns.find(x => x.offsetParent !== null && (x.textContent || '').includes('→') && !(x.textContent || '').includes('Indent'))?.click() })
  await p.waitForTimeout(400)
}
const st = await p.evaluate(() => {
  const canvas = [...document.querySelectorAll('div')].find(d => d.className?.toString().includes('bg-white shadow-xl'))
  const r = canvas.getBoundingClientRect()
  // 正文 shape（y≈22%）
  const shapes = [...canvas.querySelectorAll('div[style*=left]')].map(el => {
    const er = el.getBoundingClientRect()
    return { el, y: Math.round((er.y - r.y) / r.height * 100), h: Math.round(er.height / r.height * 100) }
  })
  const body = shapes.find(s => s.h > 40)
  if (!body) return { err: 'no body shape' }
  // 文字颜色
  const span = body.el.querySelector('span')
  const inner = body.el.querySelector('div[style*=justify]') || body.el
  return {
    shapeColor: getComputedStyle(body.el).color,
    innerColor: getComputedStyle(inner).color,
    spanColor: span ? getComputedStyle(span).color : null,
    spanText: span?.textContent?.slice(0, 20),
    spanFontSize: span ? getComputedStyle(span).fontSize : null,
  }
})
console.log('第4页正文:', JSON.stringify(st, null, 1))
await b.close()
