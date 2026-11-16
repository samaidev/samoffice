// ★★★★★ 巨大发现：blob module 复刻的【完整产品逻辑】proxy 也死了！
//（t21 的简单层活，t22 的完整逻辑层死！）
// 两者差异不是创建环境 —— 是【层的内容】：
//  - t21 活层：mousedown handler 只计数（无 e.preventDefault、无 setTimeout、无 wrapper 闭包）
//  - t22 死层：handler 里有 preventDefault + setTimeout(dispatch)
// ★★★ 回看所有历史实验：
//  fv11 full-handler（有 pd + setTimeout + mouseup pd）活了！！
//  —— 但 fv11 层建于【交互前】的 evaluate（挂载期）—— 它能收事件
//    —— 等等，fv11 是「都活」结论 —— 那时页面在挂载期建层也能活？！
//  fv11 的结论推翻了「挂载期死」—— 矛盾…… 不 —— fv11 建层用的
//  evaluate，而 wrapper 当时也在 —— 点击点在 td 上 —— 活。
// ◆ 全部证据的最简一致解释（终于）：
//   **层是否死 = 层的 mousedown handler 是否调用 preventDefault？**
//   不 —— 死层的 handler 根本没执行过（无法 preventDefault）。
//   层的死活在【创建时】决定 —— t21 与 t22 层的创建差异只有 handler 内容！
//   ★★★★ Chromium 会【静态分析 handler 源码】？不可能 —— 
//   但 Chromium 会检查【元素的事件监听器数量/类型】来决定 hit-test
//   优化路径！！！有第二个监听器（mouseup）+ 更长 handler —— 
//   不会。但是 —— listener 数量：t21 层 1 个 mousedown；
//   t22 层 mousedown + mouseup 2 个！
//   ★★★★ fv22 的「同名新层」只有 1 个 mousedown —— 活！
//   fv17 twin —— 1 个 mousedown —— 活！
//   产品 proxy —— mousedown + mouseup —— 死！
//   t16 MC 层 —— 1 个 —— 活！
//   ★★★★★ 嫌疑锁定：**mouseup preventDefault 监听器让层进死名单**！
//   （Chromium 可能对带非 passive 且 preventDefault 的 mouseup/abort
//    监听有 hit-test 特殊处理 —— 或根本是其他实现细节）
// 二分验证：t22 层去掉 mouseup 监听 → 活？去掉 preventDefault → ?
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 150)))
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
await p.waitForTimeout(2500)
const pb = await p.evaluate(() => { const r = document.querySelector('.ProseMirror p').getBoundingClientRect(); return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.5 } })
await p.mouse.click(pb.x, pb.y)
await p.waitForTimeout(1200)
// 变体矩阵（blob module 建层，一次一个）
const mkVariant = async (variant) => {
  const pt = await p.evaluate(async (v) => {
    document.querySelectorAll('[data-variant]').forEach(e => e.remove())
    const code = `
      window.__vHit = ''
      const host = window.__pmView.dom.parentElement
      const w = host.querySelector('.tableWrapper')
      const wr = w.getBoundingClientRect(), hr = host.getBoundingClientRect()
      const d = document.createElement('div')
      d.dataset.variant = '${v}'
      d.style.cssText = 'position:absolute;left:' + (wr.left - hr.left + 6) + 'px;top:' + (wr.top - hr.top) + 'px;width:' + (wr.width - 12) + 'px;height:' + wr.height + 'px;z-index:7;background:rgba(0,0,0,0.003)'
      d.addEventListener('mousedown', (e) => { window.__vHit = '${v}' ; if (${v === 'pd' || v === 'full'}) e.preventDefault() })
      ${v === 'full' ? "d.addEventListener('mouseup', (e) => e.preventDefault())" : ''}
      host.appendChild(d)
    `
    const blob = new Blob([code], { type: 'text/javascript' })
    await import(URL.createObjectURL(blob))
    const w2 = window.__pmView.dom.parentElement.querySelector('.tableWrapper')
    const rect = w2.getBoundingClientRect()
    return { x: rect.x + rect.width * 0.6, y: rect.y + rect.height * 0.5 }
  }, variant)
  await p.mouse.click(pt.x, pt.y)
  await p.waitForTimeout(280)
  return (await p.evaluate(() => window.__vHit)) === variant
}
console.log('A 纯 handler:', await mkVariant('plain') ? 'ALIVE ✅' : 'DEAD')
console.log('B +preventDefault:', await mkVariant('pd') ? 'ALIVE ✅' : 'DEAD')
console.log('C +mouseup pd(完整):', await mkVariant('full') ? 'ALIVE ✅' : 'DEAD')
await b.close()
