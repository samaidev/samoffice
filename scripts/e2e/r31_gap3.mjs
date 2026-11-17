import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
for (const vp of [{ width: 1920, height: 1080 }, { width: 1280, height: 800 }, { width: 1024, height: 700 }]) {
  const p = await (await b.newContext({ viewport: vp })).newPage()
  p.setDefaultTimeout(30000)
  await p.goto(BASE + '/?r=' + Date.now(), { waitUntil: 'networkidle' })
  await p.waitForTimeout(1800)
  await p.evaluate(async () => {
    const r = await fetch('/test31.docx')
    const buf = await r.arrayBuffer()
    const file = new File([buf], 'test31.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
    const dt = new DataTransfer()
    dt.items.add(file)
    document.querySelector('#root > div').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
  })
  await p.waitForTimeout(6500)
  const out = await p.evaluate(() => {
    const pm = document.querySelector('.ProseMirror')
    if (!pm) return { err: 'no pm' }
    const pmr = pm.getBoundingClientRect()
    const papers = [...document.querySelectorAll('.pg-paper')].map(el => { const r = el.getBoundingClientRect(); return { top: r.top - pmr.top, bottom: r.bottom - pmr.top } })
    const walker = document.createTreeWalker(pm, NodeFilter.SHOW_TEXT)
    let n, bad = 0
    const samples = []
    while ((n = walker.nextNode())) {
      const t = (n.textContent || '').trim()
      if (!t) continue
      const rg = document.createRange(); rg.selectNodeContents(n)
      for (const r of rg.getClientRects()) {
        if (r.height <= 1 || r.width <= 1) continue
        const top = r.top - pmr.top, bottom = r.bottom - pmr.top
        if (!papers.some(pp => top >= pp.top - 1 && bottom <= pp.bottom + 1)) { bad++; if (samples.length < 3) samples.push({ t: t.slice(0, 12), top: Math.round(top) }) }
      }
    }
    return { papers: papers.length, bad, samples }
  })
  console.log(`viewport ${vp.width}x${vp.height}:`, JSON.stringify(out))
  if (vp.width === 1280) {
    const pmr = await p.evaluate(() => { const r = document.querySelector('.ProseMirror').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width } })
    await p.screenshot({ path: '/tmp/r31_view1280.png', clip: { x: pmr.x - 30, y: pmr.y - 10, width: Math.min(860, pmr.w + 60), height: 780 } })
  }
  await p.close()
}
await b.close()
