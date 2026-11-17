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
  const paras = [...pm.children]
  const idx = paras.findIndex(x => (x.textContent || '').includes('参考文献'))
  const ref = paras[idx]
  const prev = paras[idx - 1]
  const r = ref.getBoundingClientRect()
  const pr = prev.getBoundingClientRect()
  return {
    idx,
    refTop: Math.round(r.top - pmr.top), refH: Math.round(r.height),
    refCls: String(ref.className),
    refStyle: ref.getAttribute('style'),
    prevTop: Math.round(pr.top - pmr.top), prevBottom: Math.round(pr.bottom - pmr.top),
    prevCls: String(prev.className).slice(0, 30),
    prevText: (prev.textContent || '').slice(0, 15),
    // pm 顶部 padding（内容盒坐标系偏移）
    pmScrollTop: Math.round(pm.getBoundingClientRect().top),
  }
})
console.log(JSON.stringify(out, null, 1))
await b.close()
