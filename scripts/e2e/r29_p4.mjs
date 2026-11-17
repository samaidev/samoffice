// sam 正文行还是没出现（只有标题 42-48）—— 正文形状在 UDM 里几何对了
// 但画布上没渲染？检查画布 DOM 里的正文 shape：
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
// 翻到第 4 页（有正文）
// View 标签 → 下一页按钮（1763-1764 RibbonButton icon ←/→）
await p.evaluate(() => { document.querySelector('[data-testid=ribbon-tab-view]')?.click() })
await p.waitForTimeout(600)
const nextBtn = await p.evaluate(() => {
  const btns = [...document.querySelectorAll('button')]
  const nb = btns.find(x => x.offsetParent !== null && (x.textContent || '').includes('→') && !(x.textContent || '').includes('Indent'))
  if (nb) { nb.click(); return 'clicked' }
  return btns.filter(x => x.offsetParent !== null && (x.textContent || '').match(/^[←→]/)).map(x => x.textContent.slice(0, 12))
})
console.log('下一页按钮:', JSON.stringify(nextBtn))
await p.waitForTimeout(300)
const nb2 = await p.evaluate(() => {
  const btns = [...document.querySelectorAll('button')]
  const nb = btns.find(x => x.offsetParent !== null && (x.textContent || '').includes('→') && !(x.textContent || '').includes('Indent'))
  if (nb) { nb.click(); return 'clicked' }
  return null
})
await p.waitForTimeout(300)
const nb3 = await p.evaluate(() => {
  const btns = [...document.querySelectorAll('button')]
  const nb = btns.find(x => x.offsetParent !== null && (x.textContent || '').includes('→') && !(x.textContent || '').includes('Indent'))
  if (nb) { nb.click(); return 'clicked' }
  return null
})
console.log('再点两次:', nb2, nb3)
await p.waitForTimeout(1500)
await p.waitForTimeout(1200)
const st = await p.evaluate(() => {
  const pager = (document.body.textContent || '').match(/\d+ \/ \d+/)?.[0]
  const canvas = [...document.querySelectorAll('div')].find(d => d.className?.toString().includes('bg-white shadow-xl'))
  const r = canvas.getBoundingClientRect()
  const shapes = [...canvas.querySelectorAll('div[style*=left]')].map(el => {
    const er = el.getBoundingClientRect()
    return { y: Math.round((er.y - r.y) / r.height * 100), h: Math.round(er.height / r.height * 100), text: (el.textContent || '').slice(0, 16) }
  }).filter(s => s.h > 2)
  return { pager, shapes }
})
console.log(JSON.stringify(st, null, 1))
await b.close()
