// SEL:52 又来（PM 原生，非我们代码）。proxy mousedown 仍没触发。
// 现在 proxy 建于交互后 400ms —— 还是死。fv17 twin（70ms）活——
// 都是 setTimeout。差异只剩【执行环境】：effect 闭包 vs evaluate。
// ◆◆◆ 大胆假设直接验证：**管理器 effect 的 setTimeout 回调执行时，
// React 处于 ConcurrentMode 的 BatchedUpdates 挂起状态？** —— 无稽。
// 换个角度：【页面上 proxy 是否真的存在且盖在 td 上】此刻验证：
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
await p.waitForTimeout(2000) // 400ms + 1200ms 双保险后
const st = await p.evaluate(() => {
  const proxy = document.querySelector('.pm-table-clickproxy')
  const td = document.querySelector('td')
  if (!proxy) return { exists: false }
  const pr = proxy.getBoundingClientRect(), tr = td.getBoundingClientRect()
  // proxy 在 pm-host 里的 offsetParent 链 + 实际落点
  return {
    exists: true,
    proxyRect: [Math.round(pr.x), Math.round(pr.y), Math.round(pr.width), Math.round(pr.height)],
    tdRect: [Math.round(tr.x), Math.round(tr.y), Math.round(tr.width), Math.round(tr.height)],
    overlapCenter: pr.x <= tr.x + tr.width * 0.6 && pr.x + pr.width >= tr.x + tr.width * 0.6 && pr.y <= tr.y + tr.height * 0.5 && pr.y + pr.height >= tr.y + tr.height * 0.5,
    topAt: (() => { const el = document.elementFromPoint(tr.x + tr.width * 0.6, tr.y + tr.height * 0.5); return (el?.className || el?.tagName || '').toString().slice(0, 30) })(),
    hostIsPmParent: proxy.parentElement === window.__pmView.dom.parentElement,
  }
})
console.log(JSON.stringify(st, null, 1))
await b.close()
