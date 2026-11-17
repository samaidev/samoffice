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
// 用 Range 量编辑态标题文字的实际行数与行高
const editLines = await p.evaluate(() => {
  const canvas = [...document.querySelectorAll('div')].find(d => (d.className || '').toString().includes('bg-white shadow-xl'))
  const span = [...canvas.querySelectorAll('span')].find(s => (s.textContent || '').includes('装备工业'))
  const range = document.createRange()
  range.selectNodeContents(span.firstChild || span)
  const rects = [...range.getClientRects()].filter(r => r.width > 5)
  return { lines: rects.length, firstW: Math.round(rects[0]?.width || 0), rectH: Math.round(rects[0]?.height || 0) }
})
console.log('编辑态标题行数:', JSON.stringify(editLines))
await p.evaluate(() => { document.querySelector('[data-testid=ribbon-tab-view]')?.click() })
await p.waitForTimeout(400)
await p.evaluate(() => { const btns = [...document.querySelectorAll('button')]; btns.find(x => x.offsetParent !== null && (x.textContent || '').includes('Play'))?.click() })
await p.waitForTimeout(1200)
const presLines = await p.evaluate(() => {
  const layer = document.querySelector('.fixed.inset-0')
  const span = [...layer.querySelectorAll('span')].find(s => (s.textContent || '').includes('装备工业'))
  const range = document.createRange()
  range.selectNodeContents(span.firstChild || span)
  const rects = [...range.getClientRects()].filter(r => r.width > 5)
  const inner = [...layer.querySelectorAll('div')].find(d => Math.round(d.getBoundingClientRect().width) === 1200)
  const scale = 1200 / 808
  return { lines: rects.length, firstW: Math.round((rects[0]?.width || 0) / scale), rectH: Math.round((rects[0]?.height || 0) / scale) }
})
console.log('放映态标题行数:', JSON.stringify(presLines))
await b.close()
