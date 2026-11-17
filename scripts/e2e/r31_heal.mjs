import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
p.on('console', m => { if (m.text().includes('R31HEAL')) console.log('[HEAL]', m.text()) })
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
await p.waitForTimeout(6000)
for (const z of [110, 120]) { await p.keyboard.down('Control'); await p.keyboard.press('='); await p.keyboard.up('Control'); await p.waitForTimeout(2800) }
console.log('-- 回 110% --')
await p.keyboard.down('Control'); await p.keyboard.press('-'); await p.keyboard.up('Control')
await p.waitForTimeout(4500)
const out = await p.evaluate(() => {
  const pm = document.querySelector('.ProseMirror')
  const pmr = pm.getBoundingClientRect()
  const papers = [...document.querySelectorAll('.pg-paper')].map(el => { const r = el.getBoundingClientRect(); return { top: r.top - pmr.top, bottom: r.bottom - pmr.top } })
  const walker = document.createTreeWalker(pm, NodeFilter.SHOW_TEXT)
  let n, bad = 0
  while ((n = walker.nextNode())) {
    const t = (n.textContent || '').trim()
    if (!t) continue
    const rg = document.createRange(); rg.selectNodeContents(n)
    for (const r of rg.getClientRects()) {
      if (r.height <= 1 || r.width <= 1) continue
      const top = r.top - pmr.top, bottom = r.bottom - pmr.top
      if (!papers.some(pp => top >= pp.top - 6 && bottom <= pp.bottom + 6)) bad++
    }
  }
  return bad
})
console.log('回程 bad:', out)
await b.close()
