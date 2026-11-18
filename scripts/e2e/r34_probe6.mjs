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
await p.waitForTimeout(800)
const out = await p.evaluate(() => {
  // 点击点
  const cell = document.querySelectorAll('table td, table th')[20]
  const r = cell.getBoundingClientRect()
  const x = r.x + r.width / 2, y = r.y + r.height / 2
  // 扫描全部元素：覆盖点击点 + 可见 + pointer-events auto
  const overlays = []
  const all = document.querySelectorAll('body *')
  for (const el of all) {
    const cs = getComputedStyle(el)
    if (cs.pointerEvents !== 'auto') continue
    if (cs.visibility === 'hidden' || cs.display === 'none') continue
    const er = el.getBoundingClientRect()
    if (er.width < 4 || er.height < 4) continue
    if (x < er.left || x > er.right || y < er.top || y > er.bottom) continue
    // 覆盖此点的元素（可能很多 —— 只记非表格内部的）
    if (el.closest('table')) continue
    overlays.push({
      tag: el.tagName, cls: (typeof el.className === 'string' ? el.className : '').slice(0, 40),
      pos: cs.position, z: cs.zIndex, opacity: cs.opacity,
      rect: { x: Math.round(er.x), y: Math.round(er.y), w: Math.round(er.width), h: Math.round(er.height) },
    })
  }
  return { point: { x: Math.round(x), y: Math.round(y) }, overlays: overlays.slice(0, 12), total: overlays.length }
})
console.log(JSON.stringify(out, null, 1))
await b.close()
