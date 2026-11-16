// 仍 from=1 —— mousedown 到 proxy 了吗？插桩正式 proxy：
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 100)))
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
const info = await p.evaluate(() => {
  const proxy = document.querySelector('.pm-table-clickproxy')
  if (!proxy) return { exists: false }
  window.__log = []
  proxy.addEventListener('mousedown', () => window.__log.push('md'), true)
  const cs = getComputedStyle(proxy)
  return { exists: true, bg: cs.backgroundColor, x: Math.round(parseFloat(proxy.style.left)), w: Math.round(parseFloat(proxy.style.width)), hostCls: (proxy.parentElement?.className || '').toString().slice(0, 25) }
})
console.log('proxy:', JSON.stringify(info))
if (info.exists) {
  const box = await p.evaluate(() => { const r = document.querySelector('td').getBoundingClientRect(); return { x: r.x + r.width * 0.6, y: r.y + r.height * 0.5 } })
  const top = await p.evaluate(([x, y]) => (document.elementFromPoint(x, y)?.className || '').toString().slice(0, 40), [box.x, box.y])
  console.log('顶层:', top)
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(400)
  console.log('事件:', JSON.stringify(await p.evaluate(() => window.__log)))
}
await b.close()
