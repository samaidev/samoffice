// ★ 画布其实存在：808x606 白底容器 + "1 / 16" 页码 + 3 张缩略图 IMG。
// 但画布 textLen=26（几乎空）—— 16 页只有 3 缩略图。
// 疑点：slides 数组只有 3 页？还是缩略图懒加载？
// 逐项检查：window 里的 slides 状态/缩略图 src/画布内 shapes DOM：
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 150)))
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
  const thumbs = [...document.querySelectorAll('img')].slice(0, 6).map(i => ({ w: i.width, src: (i.src || '').slice(0, 40) }))
  return {
    canvasChildren: canvas ? canvas.children.length : -1,
    canvasHTML: canvas ? canvas.innerHTML.slice(0, 400) : 'NOT FOUND',
    thumbs,
    pagerText: (document.body.textContent || '').match(/\d+ \/ \d+/)?.[0],
  }
})
console.log(JSON.stringify(st, null, 1))
await b.close()
