// 疑点：sam 每页白字行都是 (22,28)% —— 【标题固定在同一位置】？
// 页1 标题应在 40-47%（1.57in/7.5in=21% 起点 + 字高）—— 
// ★ 但 sam 显示 22-28 —— 而真相 40-47？！
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 120)))
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
  if (!title) return { err: 'no title' }
  const er = title.getBoundingClientRect()
  // 文本容器
  const inner = title.querySelector('div')
  const ir = inner ? inner.getBoundingClientRect() : null
  return {
    shapeBox: { y: Math.round((er.y - r.y) / r.height * 100), h: Math.round(er.height / r.height * 100) },
    justify: inner ? getComputedStyle(inner).justifyContent : null,
    vanchor: title.getAttribute('data-vanchor'),
    shapeStyle: (title.getAttribute('style') || '').slice(0, 150),
  }
})
console.log('标题框:', JSON.stringify(st, null, 1))
await b.close()
