// ★★ 全 DEAD —— 连 factor11 里活的 absolute holder 也死了！
// factor11 与 factor16 的 absolute holder 几乎一样，唯一差异：
// factor11 的 holder 挂在 document.getElementById('root') —— 相同！
// 差异：factor11 当时【没有清理上一个 holder】（首次）+ holder 有
// pointer-events:none 的外层 + inner pointer-events:auto。
// 或者 —— factor11 的 ALIVE 是【转移动作后 500ms 内的短暂活】而 factor16
// 等了 400ms？factor11 等了 500ms。
// 更可能：factor11 的成功是【一次性偶然】—— 每轮实验环境有微小差异
//（如 React 重渲染时机不同把 holder/wrapper 重建了）。
// ◆ 系统性太差。用「同页内 A/B 同时对比」消除时序因素：
// 同一时刻：原位 wrapper（死区）vs 转移的克隆（同结构不同节点）vs 
// 转移的原节点 —— 三个都在屏上，一次点击序列验证。
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
await p.evaluate(() => window.__setDocForTest({ meta: { title: 't' }, blocks: [
  { type: 'p', inline: [{ text: '段落' }] },
  { type: 'table', rows: [
    [{ inline: [{ text: 'A1' }] }, { inline: [{ text: 'B1' }] }],
    [{ inline: [{ text: 'A2' }] }, { inline: [{ text: 'B2' }] }],
  ] },
] }))
await p.waitForTimeout(2500)
const setup = await p.evaluate(() => {
  const w = document.querySelector('.tableWrapper')
  const pm = window.__pmView.dom
  // 1) 原位 wrapper（保持）
  const orig = w.querySelector('td').getBoundingClientRect()
  // 2) 克隆放 body（fixed）
  const clone = w.cloneNode(true)
  const c0 = { x: orig.x, y: orig.y + 300 > 850 ? orig.y - 300 : orig.y + 300 }
  clone.style.cssText = `position:fixed;left:${c0.x}px;top:${c0.y}px;background:#fff;border:2px solid #0a0;z-index:99999;width:400px`
  document.body.appendChild(clone)
  // 3) 转移原 wrapper 到 body 的 fixed holder
  const holder = document.createElement('div')
  const m0 = { x: orig.x, y: c0.y - 300 > 60 ? c0.y - 300 : c0.y + 200 }
  holder.style.cssText = `position:fixed;left:${m0.x}px;top:${m0.y}px;z-index:99999;background:#fff;border:2px solid #d33`
  document.body.appendChild(holder)
  holder.appendChild(w)
  window.__hits = []
  window.addEventListener('pointerdown', e => window.__hits.push((e.target.closest('[data-zone]')?.dataset.zone) || (e.target.closest('table') ? 'table?' : e.target.tagName)), { capture: true, passive: true })
  // 标注 zone
  clone.setAttribute('data-zone', 'clone-body')
  holder.setAttribute('data-zone', 'moved-orig')
  const cR = clone.getBoundingClientRect()
  const hR = holder.getBoundingClientRect()
  const oR = { x: orig.x + 50, y: orig.y + 20 } // 原位置现在空了（wrapper 已转移）—— 改点 holder 内的表
  return {
    cloneBox: { x: cR.x + 60, y: cR.y + 20 },
    holderBox: { x: hR.x + 60, y: hR.y + 20 },
  }
})
await p.waitForTimeout(500)
// 点击克隆（body fixed）
await p.mouse.click(setup.cloneBox.x, setup.cloneBox.y)
await p.waitForTimeout(200)
// 点击转移的原节点（body fixed holder）
await p.mouse.click(setup.holderBox.x, setup.holderBox.y)
await p.waitForTimeout(200)
console.log('hits:', JSON.stringify(await p.evaluate(() => window.__hits)))
await b.close()
