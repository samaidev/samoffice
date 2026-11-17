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
await p.waitForTimeout(6000)
await p.keyboard.press('Control+=')
await p.waitForTimeout(2500)
const out = await p.evaluate(() => {
  const pm = document.querySelector('.ProseMirror')
  const pmr = pm.getBoundingClientRect()
  const papers = [...document.querySelectorAll('.pg-paper')].map(el => { const r = el.getBoundingClientRect(); return { top: r.top - pmr.top, bottom: r.bottom - pmr.top } })
  const last3 = papers.slice(-3).map(x => ({ t: Math.round(x.top), b: Math.round(x.bottom) }))
  // 找 15164 附近的文字
  const walker = document.createTreeWalker(pm, NodeFilter.SHOW_TEXT)
  let n
  const hits = []
  while ((n = walker.nextNode())) {
    const t = (n.textContent || '').trim()
    if (!t.includes('客户会要更大的份额') && !t.includes('参考文献')) continue
    const rg = document.createRange(); rg.selectNodeContents(n)
    for (const r of rg.getClientRects()) {
      if (r.height <= 1) continue
      hits.push({ t: t.slice(0, 10), top: Math.round(r.top - pmr.top), bottom: Math.round(r.bottom - pmr.top) })
    }
  }
  return { papersCount: papers.length, last3, hits, pmH: Math.round(pm.getBoundingClientRect().height) }
})
console.log(JSON.stringify(out, null, 1))
await b.close()
