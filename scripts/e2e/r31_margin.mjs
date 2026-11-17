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
  // 每页内容底（假设下边距 = 96px —— 从纸高推：1123 纸高 - 内容步长）
  // 先测：pg-paper 的 padding 或统一算 —— 内容底 = 纸底 - 下边距。
  // 用第一页上一个块的已知位置反推太复杂；直接扫描「行底 > 纸底-60 且 行顶 < 纸底」
  const walker = document.createTreeWalker(pm, NodeFilter.SHOW_TEXT)
  let n
  const bad = []
  while ((n = walker.nextNode())) {
    const t = (n.textContent || '').trim()
    if (!t) continue
    const rg = document.createRange(); rg.selectNodeContents(n)
    for (const r of rg.getClientRects()) {
      if (r.height <= 1 || r.width <= 1) continue
      const top = r.top - pmr.top, bottom = r.bottom - pmr.top
      for (const pp of papers) {
        // 行与纸底边距区相交（底 60px 视觉带）
        if (top < pp.bottom - 60 && bottom > pp.bottom - 60 && bottom <= pp.bottom) {
          bad.push({ t: t.slice(0, 15), top: Math.round(top), bottom: Math.round(bottom), paperBottom: Math.round(pp.bottom) })
        }
      }
    }
  }
  return { bad: bad.length, samples: bad.slice(0, 8) }
})
console.log(JSON.stringify(out, null, 1))
await b.close()
