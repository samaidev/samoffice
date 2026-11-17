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
  const paras = [...pm.children]
  const idx = paras.findIndex(x => (x.textContent || '').includes('参考文献'))
  // ref 及前后 3 个块的标签/类
  const around = []
  for (let i = Math.max(0, idx - 3); i <= Math.min(paras.length - 1, idx + 1); i++) {
    around.push({ i, tag: paras[i].tagName, cls: String(paras[i].className).slice(0, 20), txt: (paras[i].textContent || '').slice(0, 12) })
  }
  return { idx, around }
})
console.log(JSON.stringify(out, null, 1))
await b.close()
