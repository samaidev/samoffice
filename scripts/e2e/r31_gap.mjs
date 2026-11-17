// round31 诊断③b：检测「文字落在纸页边界外（页间空白带）」——截图 + 几何
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 150)))
p.setDefaultTimeout(30000)
await p.goto(BASE + '/?r=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(2000)
await p.evaluate(async () => {
  const r = await fetch('/test31.docx')
  const buf = await r.arrayBuffer()
  const file = new File([buf], 'test31.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
  const dt = new DataTransfer()
  dt.items.add(file)
  document.querySelector('#root > div').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
})
await p.waitForTimeout(7000)

// 每张纸页矩形（pg-paper 层）vs 文字行位置：找落在纸外的文字
const out = await p.evaluate(() => {
  const pm = document.querySelector('.ProseMirror')
  const pmr = pm.getBoundingClientRect()
  const papers = [...document.querySelectorAll('.pg-paper')].map(el => { const r = el.getBoundingClientRect(); return { top: r.top - pmr.top, bottom: r.bottom - pmr.top, raw: { t: r.top, b: r.bottom, h: r.height } } })
  // 收集所有可见文本行（range rect）
  // 所有块级/行内元素（不只是文字）：任何 pm 后代元素跨过页界即报
  const bad = []
  let total = 0
  const els = [...pm.querySelectorAll('p, h1, h2, h3, h4, table, tr, td, img, .sam-math, svg, li, pre, .tableWrapper')]
  for (const el of els) {
    const r = el.getBoundingClientRect()
    if (r.height <= 1 || r.width <= 1) continue
    total++
    const top = r.top - pmr.top, bottom = r.bottom - pmr.top
    const inside = papers.some(pp => top >= pp.top - 1 && bottom <= pp.bottom + 1)
    if (!inside) bad.push({ t: el.tagName + '.' + String(el.className).slice(0, 12) + ':' + (el.textContent || '').slice(0, 10), top: Math.round(top), bottom: Math.round(bottom) })
  }
  return { papers: papers.map(x => ({ t: Math.round(x.top), b: Math.round(x.bottom), rawT: Math.round(x.raw.t), rawH: Math.round(x.raw.h) })), totalLines: total, badCount: bad.length, bad: bad.slice(0, 12) }
})
console.log('纸页数:', out.papers.length, '文本行:', out.totalLines, '纸外行:', out.badCount)
console.log('纸页边界:', JSON.stringify(out.papers.slice(0, 5)))
console.log('纸外文字样本:', JSON.stringify(out.bad, null, 1))
// 截图前 3 页区域
const pmr = await p.evaluate(() => { const r = document.querySelector('.ProseMirror').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width } })
await p.screenshot({ path: '/tmp/r31_pages.png', clip: { x: pmr.x - 30, y: pmr.y - 10, width: Math.min(820, pmr.w + 60), height: 880 } })
await b.close()
console.log('DONE')
