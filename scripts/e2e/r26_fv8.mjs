// fv7 真相：透明层 hit-test 直接穿透到 TD（TD 是死区→无事件）。
// dbg10 的测试层无背景也「活」—— 因为它们的位置计算与 proxy 不同？
// 回看 dbg10：层挂在【pm-host】= host 是 view.dom.parentElement —— 
// 但 fv7 的 twin 也挂 host…… 差异：dbg10 层 left/top = wrapper 的
// 【viewport 坐标】直接当 host 相对坐标 —— 挂错位置了（大偏移）！
// 它们根本没盖在表格上（盖到了 host 原点附近=页头区域）—— 那里本来
// 就活！fv3 同理（用 wrapper rect 直接当 left/top）。
// ◆◆◆ 全部「新层活」的实验都是【假阳性】—— 层根本不在表格上！
// ★★★ 真正的修复回到 fv7 事实：**带 alpha>0 背景的层能收到事件**
//（dbg2 OVER-TABLE 有 rgba(255,0,0,0.08) —— 收到了！）。
// 用 0.003 alpha（视觉不可察）验证：
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
await p.waitForTimeout(3500)
const r1 = await p.evaluate(() => {
  document.querySelectorAll('[data-atest]').forEach(e => e.remove())
  const host = window.__pmView.dom.parentElement
  const w = document.querySelector('.tableWrapper')
  const wr = w.getBoundingClientRect(), hr = host.getBoundingClientRect()
  const d = document.createElement('div')
  d.dataset.atest = '1'
  d.style.cssText = `position:absolute;left:${wr.left - hr.left + 6}px;top:${wr.top - hr.top}px;width:${wr.width - 12}px;height:${wr.height}px;z-index:6;background:rgba(0,0,0,0.003)`
  window.__ah = ''
  d.addEventListener('mousedown', () => { window.__ah = 'hit' })
  host.appendChild(d)
  const r = w.getBoundingClientRect()
  return { x: r.x + r.width * 0.6, y: r.y + r.height * 0.5 }
})
await p.mouse.click(r1.x, r1.y)
await p.waitForTimeout(300)
console.log('alpha=0.003 层:', await p.evaluate(() => window.__ah) || '无事件')
console.log('顶层:', await p.evaluate(([x, y]) => { const el = document.elementFromPoint(x, y); return (el?.className || el?.tagName || '').toString().slice(0, 40) }, [r1.x, r1.y]))
await b.close()
