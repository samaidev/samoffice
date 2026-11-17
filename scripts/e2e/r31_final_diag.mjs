import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
p.on('console', m => { if (m.text().includes('R31HEAL')) console.log('[HEAL]', m.text().slice(0, 30)) })
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
await p.keyboard.down('Control'); await p.keyboard.press('-'); await p.keyboard.up('Control')
await p.waitForTimeout(4500)
const out = await p.evaluate(() => {
  const pm = document.querySelector('.ProseMirror')
  const pmr = pm.getBoundingClientRect()
  const z = window.__docZoom
  const papers = [...document.querySelectorAll('.pg-paper')]
  const paper14 = papers[13].getBoundingClientRect()
  const paper15 = papers[14].getBoundingClientRect()
  const paras = [...pm.children]
  const idx = paras.findIndex(x => (x.textContent || '').includes('图12'))
  const el = paras[idx]
  const r = el.getBoundingClientRect()
  const topL = (r.top - pmr.top) / z
  // 该段的行级断点 widget（段内或前段）
  const ownLbs = el.querySelectorAll(':scope > .pg-linebreak')
  // 前面所有 widget 的 mt 总和
  let sumMt = 0, cnt = 0
  pm.querySelectorAll('.pg-linebreak').forEach(w => { sumMt += parseFloat(w.style.marginTop) || 0; cnt++ })
  return {
    z, idx,
    figTop: Math.round(topL),
    paper14: [Math.round((paper14.top - pmr.top) / z), Math.round((paper14.bottom - pmr.top) / z)],
    paper15: [Math.round((paper15.top - pmr.top) / z), Math.round((paper15.bottom - pmr.top) / z)],
    ownLbCount: ownLbs.length,
    lbTotal: cnt, sumMt: Math.round(sumMt),
    per: window.__pg.per, step: window.__pg.pageStep,
  }
})
console.log(JSON.stringify(out, null, 1))
await b.close()
