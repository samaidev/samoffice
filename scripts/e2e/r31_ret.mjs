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
// 快速 120 然后 110
await p.keyboard.down('Control'); await p.keyboard.press('='); await p.keyboard.up('Control')
await p.waitForTimeout(800)
await p.keyboard.down('Control'); await p.keyboard.press('='); await p.keyboard.up('Control')
await p.waitForTimeout(2000)
console.log('120%:', JSON.stringify(await p.evaluate(() => window.__docZoom)))
await p.keyboard.down('Control'); await p.keyboard.press('-'); await p.keyboard.up('Control')
await p.waitForTimeout(3000)
const out = await p.evaluate(() => {
  const pm = document.querySelector('.ProseMirror')
  const pmr = pm.getBoundingClientRect()
  const z = window.__docZoom
  const papers = [...document.querySelectorAll('.pg-paper')].map(el => { const r = el.getBoundingClientRect(); return { top: r.top - pmr.top, bottom: r.bottom - pmr.top } })
  // '图12' 段与它前面的 linebreak
  const paras = [...pm.children]
  const idx = paras.findIndex(x => (x.textContent || '').includes('图12'))
  const el = paras[idx]
  const top = (el.getBoundingClientRect().top - pmr.top) / z
  // 前一个块级 pg-brk 或段内 linebreak
  let prevDeco = null
  for (let i = idx - 1; i >= Math.max(0, idx - 4); i--) {
    const c = paras[i]
    if (String(c.className).includes('pg-brk')) { prevDeco = { i, kind: 'pg-brk', mt: c.style.marginTop }; break }
    const lbs = c.querySelectorAll(':scope > .pg-linebreak')
    if (lbs.length) { prevDeco = { i, kind: 'linebreak', mt: lbs[lbs.length - 1].style.marginTop }; break }
  }
  const pg = window.__pg
  const step = pg.pageStep
  const r = top % step
  return {
    z, idx, top: Math.round(top), inBlank: r > pg.per && r < step, r: Math.round(r), per: pg.per, prevDeco,
    papersCount: papers.length,
  }
})
console.log('回110%:', JSON.stringify(out, null, 1))
await b.close()
