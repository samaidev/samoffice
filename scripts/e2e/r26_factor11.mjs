// #root 内直挂 PM 也活！所以死的必要条件 = 应用自己的 DocumentEditor 链路。
// 换思路 —— 不再猜，直接【转移法】：
// 应用页死区表格，把它的【tableWrapper 节点引用】用 appendChild 转移到
// #root 的洞里（保留节点身份、事件、属性 —— 只有父链变）。若活 →
// 死因在父链（editorScroll→pageRef→scaler→pm-host→ProseMirror 某层的组合）
// 若死 → 节点本身（在被创建的上下文里被打上某种标记）。
// 注意 probe19 做过类似（移到 chain[5] 活）但那时 wrapper 是 fixed。
// 这次保持 static 流内，放到一个新 absolute 容器里盖原位置。
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
await p.evaluate(() => window.__setDocForTest({ meta: { title: 't' }, blocks: [
  { type: 'p', inline: [{ text: '段落' }] },
  { type: 'table', rows: [[{ inline: [{ text: 'A1' }] }, { inline: [{ text: 'B1' }] }]] },
] }))
await p.waitForTimeout(2500)
const res = await p.evaluate(() => {
  const w = document.querySelector('.tableWrapper')
  const r0 = w.getBoundingClientRect()
  // 新容器：fixed 全屏 + 内部 absolute 原位置 —— wrapper 保持 static
  const holder = document.createElement('div')
  holder.style.cssText = `position:fixed;inset:0;z-index:99999;pointer-events:none`
  const inner = document.createElement('div')
  inner.style.cssText = `position:absolute;left:${r0.x}px;top:${r0.y}px;width:${r0.width}px;pointer-events:auto;background:#fff;border:1px solid #d33`
  holder.appendChild(inner)
  document.getElementById('root').appendChild(holder)
  inner.appendChild(w) // 转移（保留节点身份）
  window.__ev = 0
  window.addEventListener('pointerdown', () => window.__ev++, { capture: true, passive: true })
  const r = w.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
await p.waitForTimeout(500)
await p.mouse.click(res.x, res.y)
await p.waitForTimeout(250)
console.log('PM wrapper 转移到 root 洞(保持 static):', (await p.evaluate(() => window.__ev)) > 0 ? 'ALIVE ✅' : 'DEAD')
await b.close()
