// DOM 几乎全同（idx 差 1 —— twin 在 proxy 前）。两层的差异仅剩
// 1) class 名 2) DOM 顺序 3) mousedown handler 内容。
// fv18 已测 class 名无关（with-class 活）…… 但 fv18 的层没和真 proxy
// 共存！fv17/21 双层共存时 —— 【twin idx=1 在前，proxy idx=2 在后】
// DOM 顺序后者在上（同 z-index）→ 点击命中的应是 proxy —— 但 twin
// 收到！说明【twin 在 hit-test 中、proxy 不在】。
// ◆◆◆ 唯一系统性差异：**创建 proxy 的执行栈在 PM/React 模块闭包内**。
// 双层共存让所有几何参数相同 —— Chromium 不可能凭空歧视 —— 
// 除非…… proxy 创建后【被某个 JS 改过/动过】：ResizeObserver 首回调！
// RO observe 后【立即】触发一次初始回调 → syncProxyGeometry 再跑一遍
// （同值重写 style —— 无变化）…… 但 fv10/C 变体（RO observe w+pm + 
// sync 写）活了 —— 差异：RO 回调里 fv10 的 sync 是纯函数，正式的
// syncProxyGeometry 有 `if (!this.dom.isConnected) return` 早退 —— 
// connected 无碍。
// ★★★★ 决定性一步：在 twin 的 mousedown 里【删除 proxy 再点 proxy
// 位置】—— 不。直接：把【proxy 的 handler 挂到 twin 上、twin 的挂到
// proxy 上】交换 —— 排除 handler；再【把 proxy 移到 idx=1】—— 排除顺序：
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
await p.waitForTimeout(5000)
// 实验1：删掉 twin（如果存在），只留 proxy，把 proxy 移到 host 的
// 第一个子位置 + 移除 className
const r1 = await p.evaluate(() => {
  document.querySelector('[data-twin]')?.remove()
  const proxy = document.querySelector('.pm-table-clickproxy')
  if (!proxy) return { err: 'no proxy' }
  window.__ph = ''
  proxy.addEventListener('mousedown', () => { window.__ph = 'hit' }, true)
  // 移到首位 + 改类名
  proxy.parentElement.insertBefore(proxy, proxy.parentElement.firstChild)
  proxy.className = 'proxy-renamed'
  const r = proxy.getBoundingClientRect()
  return { x: r.x + r.width * 0.6, y: r.y + r.height * 0.5 }
})
if (r1.err) { console.log(r1.err); await b.close(); process.exit(0) }
await p.mouse.click(r1.x, r1.y)
await p.waitForTimeout(300)
console.log('改名+移位后的原 proxy:', await p.evaluate(() => window.__ph) || '无')
// 实验2：全新建一个【带 class="pm-table-clickproxy"】的层
const r2 = await p.evaluate(() => {
  const host = window.__pmView.dom.parentElement
  const w = document.querySelector('.tableWrapper')
  const wr = w.getBoundingClientRect(), hr = host.getBoundingClientRect()
  const d = document.createElement('div')
  d.className = 'pm-table-clickproxy'
  d.style.cssText = `position:absolute;left:${wr.left - hr.left + 6}px;top:${wr.top - hr.top}px;width:${wr.width - 12}px;height:${wr.height}px;z-index:6;background:rgba(0,0,0,0.003)`
  window.__h2 = ''
  d.addEventListener('mousedown', () => { window.__h2 = 'hit2' })
  host.appendChild(d)
  const r = w.getBoundingClientRect()
  return { x: r.x + r.width * 0.6, y: r.y + r.height * 0.5 }
})
await p.mouse.click(r2.x, r2.y)
await p.waitForTimeout(300)
console.log('同名新层:', await p.evaluate(() => window.__h2) || '无')
await b.close()
