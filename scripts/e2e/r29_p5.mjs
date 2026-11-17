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
// 找 pager '1 / 16' 文本的父容器与兄弟按钮
const st = await p.evaluate(() => {
  const el = [...document.querySelectorAll('*')].find(x => x.children.length === 0 && /^\d+ \/ \d+$/.test((x.textContent || '').trim()) && x.offsetParent !== null)
  if (!el) return { err: 'no pager' }
  const parent = el.parentElement
  return {
    pagerText: el.textContent,
    parentHTML: parent ? parent.outerHTML.slice(0, 500) : null,
  }
})
console.log(JSON.stringify(st, null, 1))
await b.close()
