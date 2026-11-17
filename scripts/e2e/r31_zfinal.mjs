import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
p_on_log_setup = null
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
const scan = () => p.evaluate(() => {
  const pm = document.querySelector('.ProseMirror')
  const pmr = pm.getBoundingClientRect()
  const papers = [...document.querySelectorAll('.pg-paper')].map(el => { const r = el.getBoundingClientRect(); return { top: r.top - pmr.top, bottom: r.bottom - pmr.top } })
  const walker = document.createTreeWalker(pm, NodeFilter.SHOW_TEXT)
  let n, bad = 0, samples = []
  while ((n = walker.nextNode())) {
    const t = (n.textContent || '').trim()
    if (!t) continue
    const rg = document.createRange(); rg.selectNodeContents(n)
    for (const r of rg.getClientRects()) {
      if (r.height <= 1 || r.width <= 1) continue
      const top = r.top - pmr.top, bottom = r.bottom - pmr.top
      if (!papers.some(pp => top >= pp.top - 6 && bottom <= pp.bottom + 6)) { bad++; if (samples.length < 4) samples.push({ t: t.slice(0, 10), top: Math.round(top), b: Math.round(bottom) }) }
    }
  }
  return { z: window.__docZoom, bad, samples }
})
console.log('100%:', JSON.stringify(await scan()))
await p.keyboard.press('Control+='); await p.waitForTimeout(3500)
console.log('110%:', JSON.stringify(await scan()))
await p.keyboard.press('Control+='); await p.waitForTimeout(3500)
console.log('120%:', JSON.stringify(await scan()))
await p.keyboard.press('Control+-'); await p.waitForTimeout(3500)
console.log('回110%:', JSON.stringify(await scan()))
await b.close()
