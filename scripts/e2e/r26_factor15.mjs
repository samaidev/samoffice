// 背景无关。转移有效、内联属性无效 → 差异是【appendChild 这个动作】
// （DOM move 触发 Chromium 的 layer invalidate + re-add），而【属性变化】
// 不触发。这完全符合「合成器 hit-test 快照陈旧」的特征。
// 那么：什么动作等价于 appendChild 但无视觉副作用？
// → **把 wrapper appendChild 回原位**（先 remove 再 append 回原父原索引）！
// 验证它是否也激活（验证"move 动作"假设）：
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
// 原位重插（remove + insertBefore next）
const res = await p.evaluate(() => {
  const w = document.querySelector('.tableWrapper')
  const parent = w.parentElement
  const next = w.nextSibling
  parent.removeChild(w)
  parent.insertBefore(w, next)
  window.__ev = 0
  window.addEventListener('pointerdown', () => window.__ev++, { capture: true, passive: true })
  const r = w.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
await p.waitForTimeout(400)
await p.mouse.click(res.x, res.y)
await p.waitForTimeout(250)
console.log('原位重插 wrapper:', (await p.evaluate(() => window.__ev)) > 0 ? 'ALIVE ✅✅✅' : 'DEAD')
// 若 ALIVE → PM DOMObserver 会因这次外部 move 报 mutation → 可能重渲染
// 恢复死区。再点一次验证稳定性：
await p.evaluate(() => { window.__ev = 0 })
await p.mouse.click(res.x, res.y)
await p.waitForTimeout(250)
console.log('再次点击:', (await p.evaluate(() => window.__ev)) > 0 ? '仍 ALIVE ✅' : '回 DEAD')
await b.close()
