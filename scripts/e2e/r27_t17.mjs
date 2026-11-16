// MessageChannel 和 rIC 建层都活！setTimeout（effect 闭包）建层死！
// 但 evaluate 的 setTimeout 建层活（fv17/t15 twin 都是 setTimeout 建的）！
// 所以不是 setTimeout 本身 —— 是【effect 闭包里的 setTimeout】。
// React 18 effect 的 cleanup 时机/StrictMode 双执行不影响层性质……
// ★★★ 突破口：检查 manager 建的 proxy 到底是什么 —— outerHTML 对比
// mc 层 vs manager proxy（一字不差比较 + parentNode 指针）：
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
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
await p.waitForTimeout(2000)
const cmp = await p.evaluate(() => {
  const manager = document.querySelector('.pm-table-clickproxy')
  if (!manager) return { managerExists: false }
  const host = manager.parentElement
  // 复刻 manager 的创建参数再建一个（setTimeout 400 后建 —— 模拟）
  return new Promise(r2 => {
    setTimeout(() => {
      const w = host.querySelector('.tableWrapper')
      const wr = w.getBoundingClientRect(), hr = host.getBoundingClientRect()
      const d = document.createElement('div')
      d.dataset.probe = '1'
      d.className = 'pm-table-clickproxy' // 同类名！
      d.style.cssText = 'position:absolute;z-index:6;background:rgba(0,0,0,0.003)'
      host.appendChild(d)
      // 模拟 syncOne
      d.style.display = 'block'
      d.style.left = (wr.left - hr.left + 6) + 'px'
      d.style.top = (wr.top - hr.top) + 'px'
      d.style.width = Math.max(0, wr.width - 12) + 'px'
      d.style.height = wr.height + 'px'
      window.__probeHit = ''
      d.addEventListener('mousedown', () => { window.__probeHit = 'probe' })
      r2({
        managerExists: true,
        managerHTML: manager.outerHTML.slice(0, 200),
        probeHTML: d.outerHTML.slice(0, 200),
        sameParent: d.parentElement === manager.parentElement,
        mgrIdx: [...host.children].indexOf(manager),
        probeIdx: [...host.children].indexOf(d),
      })
    }, 100)
  })
})
console.log(JSON.stringify(cmp, null, 1))
// 点击（probe z6 与 manager z6 同 —— probe 后 append 在上）
const box = await p.evaluate(() => { const r = document.querySelector('td').getBoundingClientRect(); return { x: r.x + r.width * 0.6, y: r.y + r.height * 0.5 } })
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(300)
console.log('probe(同类名同代码建):', await p.evaluate(() => window.__probeHit) || '无')
await b.close()
