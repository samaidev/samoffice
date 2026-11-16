// 本地 Chromium 143 复现、shan WebView2 157 用户也报告（点击无光标）
// —— 跨版本真实 bug。
// ◆◆◆◆◆ 回到最后一个未测试的、也是唯一有理论依据的方向：
// **分页引擎的 pg-paper 是 sibling overlay —— .ProseMirror 的父级 pm-host
// 里有 position:relative + zIndex:1 的层链**。
// factor12 的 absolute holder 挂链内 L0-L4 全活（那次是内容修正后吗？—— 
// 是 factor12 在修正前跑的！内容空！无效数据！）
// ★★★ 内容修正后的「holder 在链内」实验还没做过！r26_real10 只测了 pm-host。
// 立即重测：内容正确 + wrapper absolute 挂在【链内每一层】：
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 100)))
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
await p.evaluate(() => window.__setDocForTest({ meta: { title: 't' }, blocks: [
  { type: 'p', inline: [{ content: '段落内容一' }] },
  { type: 'table', rows: [
    [{ inline: [{ content: 'A1' }] }, { inline: [{ content: 'B1' }] }],
    [{ inline: [{ content: 'A2' }] }, { inline: [{ content: 'B2' }] }],
  ] },
] }))
await p.waitForTimeout(3000)
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
    document.querySelectorAll('[data-mv]').forEach(e => e.remove())
    const pm = window.__pmView.dom
    const pageRef = pm.closest('.mx-auto')
    const arr = []
    let el = pm.parentElement
    while (el && el !== pageRef) { arr.push(el); el = el.parentElement }
    arr.push(pageRef)
    const host = arr[i]
    const w = document.querySelector('.tableWrapper')
    const r0 = w.getBoundingClientRect()
    const holder = document.createElement('div')
    holder.setAttribute('data-mv', '1')
    holder.style.cssText = `position:absolute;left:${r0.x}px;top:${r0.y}px;width:${r0.width}px;pointer-events:auto;background:#fff;z-index:5`
    host.appendChild(holder)
    holder.appendChild(w)
    window.__ev = 0
    window.addEventListener('pointerdown', () => window.__ev++, { capture: true, passive: true })
    const r = w.getBoundingClientRect()
    return { x: r.x + r.width * 0.6, y: r.y + r.height * 0.5, vis: r.y > 0 && r.y < 880, host: (host.className || host.tagName).toString().slice(0, 18) }
  }, i)
  await p.waitForTimeout(400)
  if (!res || !res.vis) { results.push(`L${i}: 视口外`); continue }
  await p.mouse.click(res.x, res.y)
  await p.waitForTimeout(220)
  const alive = (await p.evaluate(() => window.__ev)) > 0
  results.push(`L${i}(${res.host}): ${alive ? 'ALIVE ✅' : 'DEAD'}`)
  if (alive) break
}
console.log(results.join('\n'))
await b.close()
