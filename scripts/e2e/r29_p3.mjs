import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
await p.goto(BASE + '/?r=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(2000)
await p.evaluate(async () => {
  const r = await fetch('/upload-test.pptx')
  const buf = await r.arrayBuffer()
  const file = new File([buf], 'test.pptx', { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })
  const dt = new DataTransfer()
  dt.items.add(file)
  document.querySelector('#root > div').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
})
await p.waitForTimeout(6000)
const st = await p.evaluate(() => {
  const canvas = [...document.querySelectorAll('div')].find(d => d.className?.toString().includes('bg-white shadow-xl'))
  const r = canvas.getBoundingClientRect()
  const title = [...canvas.querySelectorAll('div[style*=left]')].find(el => (el.textContent || '').includes('装备工业'))
  // 层级结构 + 每层垂直样式
  const chain = []
  let el = title
  for (let i = 0; i < 4 && el; i++) {
    const cs = getComputedStyle(el)
    const er = el.getBoundingClientRect()
    chain.push({
      cls: (el.className || '').toString().slice(0, 40),
      display: cs.display, flexDirection: cs.flexDirection,
      justifyContent: cs.justifyContent, alignItems: cs.alignItems,
      textTop: Math.round((er.top - r.top) / r.height * 100),
      textH: Math.round(er.height / r.height * 100),
      style: (el.getAttribute('style') || '').slice(0, 100),
    })
    el = el.firstElementChild
  }
  return chain
})
console.log(JSON.stringify(st, null, 1))
await b.close()
