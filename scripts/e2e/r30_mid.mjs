// 差异集中在 31-48%（标题文字带）。检查两态标题文字的渲染样式差异：
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
// 编辑态标题 span 样式
const editSpan = await p.evaluate(() => {
  const canvas = [...document.querySelectorAll('div')].find(d => (d.className || '').toString().includes('bg-white shadow-xl'))
  const span = [...canvas.querySelectorAll('span')].find(s => (s.textContent || '').includes('装备工业'))
  if (!span) return null
  const cs = getComputedStyle(span)
  const r = span.getBoundingClientRect()
  const cr = canvas.getBoundingClientRect()
  return { fontSize: cs.fontSize, color: cs.color, weight: cs.fontWeight, shadow: cs.textShadow.slice(0, 40), x: Math.round(r.x - cr.x), y: Math.round(r.y - cr.y), w: Math.round(r.width) }
})
console.log('编辑态标题:', JSON.stringify(editSpan))
// 进放映
await p.evaluate(() => { document.querySelector('[data-testid=ribbon-tab-view]')?.click() })
await p.waitForTimeout(400)
await p.evaluate(() => { const btns = [...document.querySelectorAll('button')]; btns.find(x => x.offsetParent !== null && (x.textContent || '').includes('Play'))?.click() })
await p.waitForTimeout(1200)
const presSpan = await p.evaluate(() => {
  // 放映层 fixed inset-0 内的 span
  const layer = document.querySelector('.fixed.inset-0')
  if (!layer) return { err: 'no layer' }
  const span = [...layer.querySelectorAll('span')].find(s => (s.textContent || '').includes('装备工业'))
  if (!span) return { err: 'no span', spans: [...layer.querySelectorAll('span')].slice(0, 5).map(s => s.textContent?.slice(0, 10)) }
  const cs = getComputedStyle(span)
  const r = span.getBoundingClientRect()
  const layerR = layer.getBoundingClientRect()
  // 放映层有 scale 变换 —— 找 808 宽的内层容器坐标
  const inner = [...layer.querySelectorAll('div')].find(d => Math.round(d.getBoundingClientRect().width) >= 700 && Math.round(d.getBoundingClientRect().width) <= 900)
  const ir = inner ? inner.getBoundingClientRect() : layerR
  return { fontSize: cs.fontSize, color: cs.color, weight: cs.fontWeight, shadow: cs.textShadow.slice(0, 40), x: Math.round(r.x - ir.x), y: Math.round(r.y - ir.y), w: Math.round(r.width), scale: inner ? getComputedStyle(inner.parentElement).transform.slice(0, 30) : null }
})
console.log('放映态标题:', JSON.stringify(presSpan))
await b.close()

// 追加：两态形状容器宽度对比
// 重新打开（前一次已 close）—— 改为直接重跑整段
await (async () => {
  const b2 = await chromium.launch({ args: ['--no-sandbox'] })
  const p2 = await (await b2.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
  p2.setDefaultTimeout(30000)
  await p2.goto(BASE + '/?r=' + Date.now(), { waitUntil: 'networkidle' })
  await p2.waitForTimeout(2000)
  await p2.evaluate(async () => {
    const r = await fetch('/upload-test.pptx')
    const buf = await r.arrayBuffer()
    const file = new File([buf], 'test.pptx', { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })
    const dt = new DataTransfer()
    dt.items.add(file)
    document.querySelector('#root > div').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
  })
  await p2.waitForTimeout(6000)
  const editW = await p2.evaluate(() => {
    const canvas = [...document.querySelectorAll('div')].find(d => (d.className || '').toString().includes('bg-white shadow-xl'))
    const shape = [...canvas.querySelectorAll('div[style*=left]')].find(el => (el.textContent || '').includes('装备工业'))
    const r = shape.getBoundingClientRect()
    return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x - canvas.getBoundingClientRect().x) }
  })
  console.log('编辑态标题形状框:', JSON.stringify(editW))
  await p2.evaluate(() => { document.querySelector('[data-testid=ribbon-tab-view]')?.click() })
  await p2.waitForTimeout(400)
  await p2.evaluate(() => { const btns = [...document.querySelectorAll('button')]; btns.find(x => x.offsetParent !== null && (x.textContent || '').includes('Play'))?.click() })
  await p2.waitForTimeout(1200)
  const presW = await p2.evaluate(() => {
    const layer = document.querySelector('.fixed.inset-0')
    const shape = [...layer.querySelectorAll('div[style*=left]')].find(el => (el.textContent || '').includes('装备工业'))
    if (!shape) return { err: 'no shape' }
    const r = shape.getBoundingClientRect()
    const allW = [...layer.querySelectorAll('div')].map(d => Math.round(d.getBoundingClientRect().width)).filter(w => w > 100)
    const inner = [...layer.querySelectorAll('div')].filter(d => { const w = Math.round(d.getBoundingClientRect().width); return w >= 700 && w <= 900 }).pop()
    if (!inner) return { err: 'no inner', allW: [...new Set(allW)].slice(0, 10) }
    const ir = inner.getBoundingClientRect()
    const scale = inner.getBoundingClientRect().width / 808
    return { w: Math.round(r.width / scale), h: Math.round(r.height / scale), x: Math.round((r.x - ir.x) / scale) }
  })
  console.log('放映态标题形状框(除scale):', JSON.stringify(presW))
  await b2.close()
})()
