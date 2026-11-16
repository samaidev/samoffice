// 时序空 —— document 级 capture 都收不到（连 mousedown 都没了）！
// 但 dbg2 的 OVER-TABLE 层收到了？差异：dbg2 层挂在 pm-host、无 cursor、
// z-index:7、**有半透明背景 rgba(255,0,0,0.08)**！
// 我们的 proxy：透明背景 + cursor:text + contenteditable="false"。
// ★★★ 疑点：**contenteditable="false"** —— 在 contenteditable 宿主树附近
// 的 CE=false 层可能进入 Chromium 的 editable 边界处理 → hit-test 特判！
// 立即验证：去掉 contenteditable 属性 / 换 background：
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 100)))
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
await p.evaluate(() => window.__setDocForTest({ meta: { title: 't' }, blocks: [
  { type: 'p', inline: [{ content: '段落 content 一' }] },
  { type: 'table', rows: [
    [{ inline: [{ content: 'A1' }] }, { inline: [{ content: 'B1' }] }],
    [{ inline: [{ content: 'A2' }] }, { inline: [{ content: 'B2' }] }],
  ] },
] }))
await p.waitForTimeout(3000)
// 在 proxy 正上方再放一层：无 CE 属性、无 cursor —— 完全朴素
await p.evaluate(() => {
  const proxy = document.querySelector('.pm-table-clickproxy')
  const plain = document.createElement('div')
  plain.dataset.tag = 'plain'
  const r = proxy.getBoundingClientRect()
  plain.style.cssText = `position:absolute;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;z-index:9;background:rgba(0,255,0,0.05)`
  window.__hit2 = ''
  plain.addEventListener('mousedown', () => { window.__hit2 = 'plain' })
  proxy.parentElement.appendChild(plain)
  window.__plain = plain
})
const box = await p.evaluate(() => { const r = window.__plain.getBoundingClientRect(); return { x: r.x + r.width * 0.7, y: r.y + r.height * 0.5 } })
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(250)
console.log('朴素层（无CE无cursor）:', await p.evaluate(() => window.__hit2) || '无事件')
await b.close()
