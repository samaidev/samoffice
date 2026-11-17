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
  const z = 1.1
  // 模拟 pg-measuring：读 ref 段的【自然 top】（当前 DOM 无 margin —— ref 无装饰）
  const paras = [...pm.children]
  const idx = paras.findIndex(x => (x.textContent || '').includes('参考文献'))
  const ref = paras[idx]
  const refTop = (ref.getBoundingClientRect().top - pmr.top) / z
  // 前一段（idx-1）是否有装饰
  const prev = paras[idx - 1]
  const prevCls = String(prev.className)
  // ref 的前兄弟们里最后一个 .pg-brk / 行级断点位置
  let lastDecoBefore = null
  for (let i = 0; i < idx; i++) {
    const c = paras[i]
    if (String(c.className).includes('pg-brk')) lastDecoBefore = { i, cls: 'pg-brk', mt: c.style.marginTop, text: (c.textContent || '').slice(0, 10) }
    const lbs = c.querySelectorAll(':scope > .pg-linebreak')
    if (lbs.length) lastDecoBefore = { i, cls: 'linebreak', mt: lbs[lbs.length - 1].style.marginTop, text: (c.textContent || '').slice(0, 10) }
  }
  // 页几何（布局）
  const pg = window.__pg
  return {
    idx, refTop: Math.round(refTop), prevCls: prevCls.slice(0, 25),
    lastDecoBefore,
    pageStep: pg.pageStep, per: pg.per,
    // ref 自然顶落在哪页：pageOf = floor(refTop / pageStep)
    refPage: Math.floor(refTop / pg.pageStep),
    refPageBottom: Math.floor(refTop / pg.pageStep) * pg.pageStep + pg.per,
    expectBreak: refTop + 27 > Math.floor(refTop / pg.pageStep) * pg.pageStep + pg.per,
  }
})
console.log(JSON.stringify(out, null, 1))
await b.close()
