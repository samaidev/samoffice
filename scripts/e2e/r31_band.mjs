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
  // 每张纸内的内容块行位置（块级元素）
  const blocks = [...pm.children]
  const bands = []
  for (let i = 0; i < papers.length; i++) {
    const pp = papers[i]
    // 纸内可见块
    const inPaper = blocks.filter(bl => { const r = bl.getBoundingClientRect(); const top = r.top - pmr.top; return top >= pp.top - 2 && top < pp.bottom - 2 && r.height > 0 })
    if (inPaper.length < 3) continue
    // 块间隙 >120px 且不是页首/页尾 → 可疑空白带
    const tops = inPaper.map(bl => { const r = bl.getBoundingClientRect(); return { top: Math.round(r.top - pmr.top), bottom: Math.round(r.bottom - pmr.top), txt: (bl.textContent || '').slice(0, 10) } })
    for (let j = 1; j < tops.length; j++) {
      const g = tops[j].top - tops[j - 1].bottom
      if (g > 120) bands.push({ page: i + 1, gapPx: g, after: tops[j - 1].txt, before: tops[j].txt, at: tops[j - 1].bottom })
    }
  }
  return { totalPapers: papers.length, suspiciousBands: bands.slice(0, 8) }
})
console.log(JSON.stringify(out, null, 1))
await b.close()
