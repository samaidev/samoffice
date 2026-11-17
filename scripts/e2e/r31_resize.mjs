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
const scan = () => p.evaluate(() => {
  const pm = document.querySelector('.ProseMirror')
  const pmr = pm.getBoundingClientRect()
  const papers = [...document.querySelectorAll('.pg-paper')].map(el => { const r = el.getBoundingClientRect(); return { top: r.top - pmr.top, bottom: r.bottom - pmr.top } })
  const walker = document.createTreeWalker(pm, NodeFilter.SHOW_TEXT)
  let n, bad = 0, worst = null
  while ((n = walker.nextNode())) {
    const t = (n.textContent || '').trim()
    if (!t) continue
    const rg = document.createRange(); rg.selectNodeContents(n)
    for (const r of rg.getClientRects()) {
      if (r.height <= 1 || r.width <= 1) continue
      const top = r.top - pmr.top, bottom = r.bottom - pmr.top
      if (!papers.some(pp => top >= pp.top - 1 && bottom <= pp.bottom + 1)) { bad++; if (!worst) worst = { t: t.slice(0, 12), top: Math.round(top), bottom: Math.round(bottom) } }
    }
  }
  return { papers: papers.length, bad, worst }
})
console.log('初始:', JSON.stringify(await scan()))
// resize 窗口（内容区宽度变化 → pageWidthPx 可能变）
await p.setViewportSize({ width: 1000, height: 760 })
await p.waitForTimeout(400)  // ← 关键：只等 400ms（纸页层重绘了，但分页可能没重算）
console.log('resize+400ms:', JSON.stringify(await scan()))
await p.waitForTimeout(3000) // 等 3.4s 看是否最终自愈
console.log('resize+3.4s:', JSON.stringify(await scan()))
await b.close()
