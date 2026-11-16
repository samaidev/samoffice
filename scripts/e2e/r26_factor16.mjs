// 原位重插死、转移到 holder 活。差别 = holder 的 position:absolute！
// 转移后 wrapper 在 absolute 容器里（z-index 99999 + 不透明背景 + pointer-events:auto）。
// probe44 的 fixed 表在链内也死 —— 但那是【新建表】。现在做精确对照：
// 同一 wrapper，转移到【无 absolute 的 plain div】（root 下 static）vs
// 【absolute holder】。若只有 absolute 活 → 激活因子 = 「进入独立定位层」。
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
// 实验序列（每轮把 wrapper 从当前宿主转移到新宿主）：
const variants = [
  ['absolute holder(z99999白底)', () => {
    document.querySelectorAll('[data-mv]').forEach(e => e.remove())
    const w = document.querySelector('.tableWrapper')
    const r0 = w.getBoundingClientRect()
    const h = document.createElement('div')
    h.setAttribute('data-mv', '1')
    h.style.cssText = `position:absolute;left:${r0.x}px;top:${r0.y}px;width:${r0.width}px;z-index:99999;background:#fff;pointer-events:auto`
    document.getElementById('root').appendChild(h)
    h.appendChild(w)
  }],
  ['absolute holder(无背景无z)', () => {
    document.querySelectorAll('[data-mv]').forEach(e => e.remove())
    const w = document.querySelector('.tableWrapper')
    const r0 = w.getBoundingClientRect()
    const h = document.createElement('div')
    h.setAttribute('data-mv', '1')
    h.style.cssText = `position:absolute;left:${r0.x}px;top:${r0.y}px;width:${r0.width}px`
    document.getElementById('root').appendChild(h)
    h.appendChild(w)
  }],
  ['relative holder(偏移回原位)', () => {
    document.querySelectorAll('[data-mv]').forEach(e => e.remove())
    const w = document.querySelector('.tableWrapper')
    const r0 = w.getBoundingClientRect()
    const h = document.createElement('div')
    h.setAttribute('data-mv', '1')
    // relative + 负 margin 推回原位
    h.style.cssText = `position:relative;margin-left:${r0.x - 8}px;margin-top:${r0.y - 200}px;width:${r0.width}px`
    document.getElementById('root').appendChild(h)
    h.appendChild(w)
  }],
  ['static holder(body 流内)', () => {
    document.querySelectorAll('[data-mv]').forEach(e => e.remove())
    const w = document.querySelector('.tableWrapper')
    const h = document.createElement('div')
    h.setAttribute('data-mv', '1')
    document.getElementById('root').appendChild(h)
    h.appendChild(w)
  }],
]
for (const [name, apply] of variants) {
  const res = await p.evaluate((src) => {
    new Function(src)()
    window.__ev = 0
    window.addEventListener('pointerdown', () => window.__ev++, { capture: true, passive: true })
    const r = document.querySelector('.tableWrapper').getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, vis: r.y > 0 && r.y < 880 && r.x > 0 && r.x < 1340 }
  }, apply.toString())
  await p.waitForTimeout(400)
  if (!res.vis) { console.log(`${name}: 视口外(${Math.round(res.x)},${Math.round(res.y)})`); continue }
  await p.mouse.click(res.x, res.y)
  await p.waitForTimeout(220)
  console.log(`${name}:`, (await p.evaluate(() => window.__ev)) > 0 ? 'ALIVE ✅' : 'DEAD')
}
await b.close()
