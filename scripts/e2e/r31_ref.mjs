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
  // '参考文献：' 段落元素（块级）与其文本行
  const paras = [...pm.querySelectorAll('p, h1, h2, h3')]
  const ref = paras.find(x => (x.textContent || '').includes('参考文献'))
  const rr = ref.getBoundingClientRect()
  // 该段所在纸
  const paperIdx = papers.findIndex(pp => rr.top - pmr.top >= pp.top - 6 && rr.bottom - pmr.top <= pp.bottom + 6)
  return {
    paraTop: Math.round(rr.top - pmr.top), paraBottom: Math.round(rr.bottom - pmr.top),
    paperIdx, papersAll: papers.map(x => [Math.round(x.t || x.top), Math.round(x.b || x.bottom)]),
    paraCls: String(ref.className).slice(0, 30),
    paraPrevCls: String(ref.previousElementSibling?.className || '').slice(0, 20),
    lastPaperTop: Math.round(papers[papers.length - 1].top), lastPaperBottom: Math.round(papers[papers.length - 1].bottom),
  }
})
console.log(JSON.stringify(out, null, 1))
await b.close()
