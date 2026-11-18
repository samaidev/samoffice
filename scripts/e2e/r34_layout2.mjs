import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
await p.goto(BASE + '/?r=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(2500)
await p.evaluate(async () => {
  const r = await fetch('/upload-test.docx')
  const buf = await r.arrayBuffer()
  const file = new File([buf], 'upload-test.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
  const dt = new DataTransfer()
  dt.items.add(file)
  document.querySelector('#root > div').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
})
await p.waitForTimeout(9000)
await p.evaluate(() => { document.querySelector('table').scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(1000)
const snap = () => p.evaluate(() => {
  const pm = document.querySelector('.ProseMirror')
  // wrapper 索引 + 前后 12 个兄弟块的位置/高度
  const kids = Array.from(pm.children)
  const ti = kids.findIndex(k => k.classList?.contains('tableWrapper'))
  const out = []
  for (let i = Math.max(0, ti - 40); i <= Math.min(kids.length - 1, ti - 3); i++) {
    const k = kids[i]
    const r = k.getBoundingClientRect()
    const cs = getComputedStyle(k)
    out.push({ i, cls: (typeof k.className === 'string' ? k.className : k.tagName).slice(0, 16), y: Math.round(r.y), h: Math.round(r.height), mt: cs.marginTop, mb: cs.marginBottom, pt: cs.paddingTop, pb: cs.paddingBottom })
  }
  return { ti, out }
})
const before = await snap()
await p.evaluate(() => {
  const c = document.querySelectorAll('table td, table th')[9]
  const r = c.getBoundingClientRect()
  window.__clickPt = { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
const spot = await p.evaluate(() => window.__clickPt)
await p.mouse.click(spot.x, spot.y)
await p.waitForTimeout(500)
const after = await snap()
console.log('wrapper idx=' + before.ti)
before.out.forEach((s, j) => {
  const a = after.out[j]
  if (s.y !== a.y || s.h !== a.h || s.mt !== a.mt || s.mb !== a.mb) {
    console.log(`★块${s.i} ${s.cls}: y ${s.y}→${a.y} h ${s.h}→${a.h} mt ${s.mt}→${a.mt} mb ${s.mb}→${a.mb}`)
  }
})
console.log('done')
await b.close()
