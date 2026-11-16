// 全部手工变体都活（含完整 handler）！正式 proxy 死。
// 手工层与正式 proxy 的最终差异 = 【创建者上下文】：
// 手工 = evaluate 的 setTimeout；正式 = DocTableView 闭包的 setTimeout。
// ◆◆◆ 会不会 —— 正式 proxy 的 mousedown 真的到达了，但
// cellAtPoint 返回 null（getBoundingClientRect 读到 0）→ return 无痕？
// fv9 的插桩（capture 计数）显示 [] —— 计数器在 handler 之前 —— 
// 到没到 handler 都会记 …… 除非 fv9 的插桩时机在【点击之后】挂的？
// 不 —— fv9 在点击前挂。事件 [] = 没到达。
// ◆ 正式 proxy 的 style.left=126px —— 挂在 host 的 126px 处。
// 手工层 left=126+? 让我比对：fv11 层 left = wr.left-hr.left+6 —— 
// 与正式完全同算法。除非 host 不同！fv9 显示 hostCls='   '（类名空白）
// —— view.dom.parentElement 的 className —— 可能是【另一个 div】！
// 手工层的 host 也是 view.dom.parentElement —— 相同……
// ★★★★ 验证终极假设：把【正式 proxy】删掉重建（同 fv11 形态）—— 
// 如果新建的活而正式的死 —— 就是创建上下文/时机问题；如果新建的也死
// —— 正式 proxy 的几何（left/top 值）有毒：
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
await p.waitForTimeout(4000)
// 读正式 proxy 的完整 style 值，删掉它，然后用【完全相同的 style】重建
const clone = await p.evaluate(() => {
  const proxy = document.querySelector('.pm-table-clickproxy')
  if (!proxy) return null
  const styleAttr = proxy.getAttribute('style')
  const hostCls = (proxy.parentElement?.className || '').toString()
  proxy.remove()
  const host = window.__pmView.dom.parentElement
  const d = document.createElement('div')
  d.className = 'pm-table-clickproxy-clone'
  d.setAttribute('style', styleAttr)
  window.__ch = ''
  d.addEventListener('mousedown', () => { window.__ch = 'clone-hit' })
  host.appendChild(d)
  const r = d.getBoundingClientRect()
  return { x: r.x + r.width * 0.6, y: r.y + r.height * 0.5, styleAttr, hostCls }
})
if (!clone) { console.log('no proxy'); await b.close(); process.exit(0) }
console.log('克隆层 style:', clone.styleAttr.slice(0, 90), 'host:', clone.hostCls)
await p.mouse.click(clone.x, clone.y)
await p.waitForTimeout(300)
console.log('克隆层点击:', await p.evaluate(() => window.__ch) || '无事件')
await b.close()
