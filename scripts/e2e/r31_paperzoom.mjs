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
const probe = () => p.evaluate(() => {
  const pm = document.querySelector('.ProseMirror')
  const paper = document.querySelector('.pg-paper')
  // 找 zoom 应用元素（css zoom 属性）
  const findZoom = (el) => {
    const chain = []
    let cur = el
    while (cur && cur !== document.body) {
      const z = getComputedStyle(cur).zoom
      if (z && z !== '1') chain.push({ tag: cur.tagName, cls: String(cur.className).slice(0, 25), z })
      cur = cur.parentElement
    }
    return chain
  }
  return {
    pmZoomChain: findZoom(pm),
    paperZoomChain: findZoom(paper),
    pmH: Math.round(pm.getBoundingClientRect().height),
    paperH: Math.round(paper.getBoundingClientRect().height),
  }
})
console.log('zoom 前:', JSON.stringify(await probe()))
await p.keyboard.press('Control+=')
await p.waitForTimeout(1500)
console.log('zoom 后:', JSON.stringify(await probe()))
await b.close()
