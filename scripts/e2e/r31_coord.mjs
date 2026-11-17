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
  const pg = window.__pg || {}
  const bt = window.__bodyTop || {}
  // 纸页 DOM 实况 vs __pg 诊断
  const papers = [...document.querySelectorAll('.pg-paper')].map(el => Math.round(el.getBoundingClientRect().top))
  const pm = document.querySelector('.ProseMirror')
  const pmr = pm.getBoundingClientRect()
  // 参考文献段
  const paras = [...pm.children]
  const ref = paras.find(x => (x.textContent || '').includes('参考文献'))
  return {
    pg: { pageCount: pg.pageCount, pageStep: pg.pageStep, per: pg.per, gap: pg.gap },
    bodyTop: bt,
    paperDomTops: papers.slice(-3),
    pmTop: Math.round(pmr.top),
    refTopAbs: Math.round(ref.getBoundingClientRect().top),
    refTopRel: Math.round(ref.getBoundingClientRect().top - pmr.top),
  }
})
console.log(JSON.stringify(out, null, 1))
await b.close()
