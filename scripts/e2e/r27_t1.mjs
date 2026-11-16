// round27：诊断管理器点击后 anchorNode 位置（打字路由最后一步）
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
// 首次交互激活管理器
const pb = await p.evaluate(() => { const r = document.querySelector('.ProseMirror p').getBoundingClientRect(); return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.5 } })
await p.mouse.click(pb.x, pb.y)
await p.waitForTimeout(600)
// 点击 td[0]
const box = await p.evaluate(() => { const r = document.querySelector('td').getBoundingClientRect(); return { x: r.x + r.width * 0.6, y: r.y + r.height * 0.5 } })
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(800)
const st = await p.evaluate(() => {
  const sel = window.getSelection()
  const anchor = sel?.anchorNode
  const td = document.querySelector('td')
  return {
    from: window.__pmView.state.selection.from,
    anchorNode: anchor?.nodeName,
    anchorInTd: anchor ? td.contains(anchor) : false,
    anchorText: anchor?.nodeName === '#text' ? anchor.textContent?.slice(0, 10) : (anchor?.textContent || '').slice(0, 10),
  }
})
console.log('点击后状态:', JSON.stringify(st))
const proxyInfo = await p.evaluate(() => {
  const proxy = document.querySelector('.pm-table-clickproxy')
  const w = document.querySelector('.tableWrapper')
  if (!proxy || !w) return { proxy: !!proxy, w: !!w }
  const pr = proxy.getBoundingClientRect(), wr = w.getBoundingClientRect()
  return { overlap: Math.abs(pr.top - wr.top) < 3 && pr.width > 100 }
})
console.log('proxy 覆盖:', JSON.stringify(proxyInfo))
await b.close()
