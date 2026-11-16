// 内容修正后结论依旧成立：
//   重写body ALIVE / 原位重插 DEAD / display双帧 DEAD / 移出PM ALIVE
// A 与 D 的共性：wrapper 的【父节点变了】（body 直挂）。B/C 父节点不变。
// → 激活条件 = 「wrapper 被 append 到一个【新创建的父元素】」
// 猜测：新父元素触发 Chromium 为子树新建 layer/paint 上下文。
// 直接测修复形态：把 wrapper 包进一个【新建的中间 div】再塞回 PM 原位！
//（wrapper.parentNode 变成新 div，新 div 占据 wrapper 原位置 —— 但 PM 的
//  docView 直接子节点结构被破坏，PM 可能立即修正/报错。先测点击，再看 PM 反应）
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 100)))
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
await p.evaluate(() => window.__setDocForTest({ meta: { title: 't' }, blocks: [
  { type: 'p', inline: [{ content: '段落内容' }] },
  { type: 'table', rows: [
    [{ inline: [{ content: 'A1' }] }, { inline: [{ content: 'B1' }] }],
    [{ inline: [{ content: 'A2' }] }, { inline: [{ content: 'B2' }] }],
  ] },
] }))
await p.waitForTimeout(3000)
const clickTd = async () => {
  await p.evaluate(() => { window.__ev = 0; window.addEventListener('pointerdown', () => window.__ev++, { capture: true, passive: true }) })
  const box = await p.evaluate(() => { const r = document.querySelector('.ProseMirror td').getBoundingClientRect(); return { x: r.x + r.width * 0.7, y: r.y + r.height * 0.5 } })
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(280)
  return (await p.evaluate(() => window.__ev)) > 0
}
console.log('baseline:', await clickTd() ? 'ALIVE' : 'DEAD')
// 修复形态验证：新中间 div 包裹 wrapper，插回原位
await p.evaluate(() => {
  const w = document.querySelector('.tableWrapper')
  const parent = w.parentElement, next = w.nextSibling
  const box = document.createElement('div')
  box.style.cssText = 'position:relative' // 与原 wrapper 布局属性等价
  parent.insertBefore(box, next)
  box.appendChild(w)
})
await p.waitForTimeout(500)
console.log('新父包裹(原位):', await clickTd() ? 'ALIVE ✅✅✅' : 'DEAD')
// PM 是否会立即修正回去？（检查 wrapper 父链）
const after = await p.evaluate(() => {
  const w = document.querySelector('.tableWrapper')
  return { parentCls: (w.parentElement?.className || w.parentElement?.tagName || '').toString().slice(0, 30) }
})
console.log('结构:', JSON.stringify(after))
// 再点一次验证稳定
console.log('再点一次:', await clickTd() ? '仍 ALIVE ✅' : '回 DEAD')
await b.close()
