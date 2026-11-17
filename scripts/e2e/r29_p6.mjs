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
// pager '1 / 16' 元素本身（非空 children 的容器）—— 从它出发找相邻按钮
const st = await p.evaluate(() => {
  const walker = [...document.querySelectorAll('span,div')].filter(x => x.children.length <= 2 && (x.textContent || '').trim().match(/^1 \/ 16$/) && x.offsetParent !== null)
  const el = walker[walker.length - 1]
  if (!el) return { err: 'no' }
  // 兄弟元素
  const sibs = [...el.parentElement.children].map(c => ({ tag: c.tagName, txt: (c.textContent || '').slice(0, 10), cls: (c.className || '').toString().slice(0, 25) }))
  return { elTag: el.tagName, elCls: (el.className || '').toString().slice(0, 30), siblings: sibs.slice(0, 8) }
})
console.log(JSON.stringify(st, null, 1))
await b.close()
