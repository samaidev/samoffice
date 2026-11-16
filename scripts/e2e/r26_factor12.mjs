// ★ 节点转移（保持 static + 原节点身份）到 root 洞 → ALIVE！
// 死因 100% 在【原父链】。probe19 的 fixed 移动实验误导过方向。
// 现在二分父链：wrapper 逐层上移（每次保持节点身份、static、
// absolute 定位到原位置避免滚动偏移）。链（from factor 阶梯）：
// 0:pm-host 1:flex层 2:z1层 3:794宽层 4:pageRef(mx-auto) 
// probe44 测过 fixed 挂链上每层 → 全 DEAD 到 L3，L4 ALIVE。
// 但 fixed 有 containing block 陷阱。这次用 absolute+转移法重测同链：
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
// 层链
const layers = await p.evaluate(() => {
  const pm = window.__pmView.dom
  const pageRef = pm.closest('.mx-auto')
  const arr = []
  let el = pm.parentElement
  while (el && el !== pageRef) { arr.push(el); el = el.parentElement }
  arr.push(pageRef)
  return arr.length
})
console.log('layers:', layers)
const results = []
for (let i = 0; i < layers; i++) {
  const res = await p.evaluate((i) => {
    const pm = window.__pmView.dom
    const pageRef = pm.closest('.mx-auto')
    const arr = []
    let el = pm.parentElement
    while (el && el !== pageRef) { arr.push(el); el = el.parentElement }
    arr.push(pageRef)
    const host = arr[i]
    const w = document.querySelector('.tableWrapper')
    // 清理上次
    document.querySelectorAll('[data-move]').forEach(e => e.remove())
    const r0 = w.getBoundingClientRect()
    const holder = document.createElement('div')
    holder.setAttribute('data-move', '1')
    holder.style.cssText = `position:absolute;left:${r0.x}px;top:${r0.y}px;width:${r0.width}px;pointer-events:auto;background:#fff;z-index:99999`
    host.appendChild(holder)
    holder.appendChild(w)
    window.__ev = 0
    window.addEventListener('pointerdown', () => window.__ev++, { capture: true, passive: true })
    const r = w.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, vis: r.y > 0 && r.y < 880, host: (host.className || host.tagName).toString().slice(0, 20) }
  }, i)
  await p.waitForTimeout(300)
  if (!res.vis) { results.push(`L${i}(${res.host}): 视口外`); continue }
  await p.mouse.click(res.x, res.y)
  await p.waitForTimeout(200)
  const alive = (await p.evaluate(() => window.__ev)) > 0
  results.push(`L${i}(${res.host}): ${alive ? 'ALIVE ✅' : 'DEAD'}`)
}
console.log(results.join('\n'))
await b.close()
