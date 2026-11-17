import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
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
const out = await p.evaluate(() => {
  const pm = document.querySelector('.ProseMirror')
  const pmr = pm.getBoundingClientRect()
  const papers = [...document.querySelectorAll('.pg-paper')].map(el => { const r = el.getBoundingClientRect(); return { top: r.top - pmr.top, bottom: r.bottom - pmr.top } })
  // 图片 + 公式块位置
  const medias = [...pm.querySelectorAll('img, .sam-math, .math-block, svg')]
  const bad = []
  for (const m of medias) {
    const r = m.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) continue
    const top = r.top - pmr.top, bottom = r.bottom - pmr.top
    const inside = papers.some(pp => top >= pp.top - 1 && bottom <= pp.bottom + 1)
    if (!inside) bad.push({ kind: m.tagName + '.' + String(m.className).slice(0, 15), top: Math.round(top), bottom: Math.round(bottom) })
  }
  return { mediaCount: medias.length, badMedia: bad.slice(0, 10) }
})
console.log(JSON.stringify(out, null, 1))
await b.close()
