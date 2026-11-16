// 代理层 covers=true 但点击后 from=1, focus=false —— mousedown 没触发？
// 可能：点击坐标被代理层覆盖（covers=true），但代理层 z-index:6 低于
// 某层 / 或者 mousedown 触发但 preventDefault 后 dispatch 失败。
// 诊断：直接给代理层挂调试日志：
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('console', m => { if (m.text().includes('R26')) console.log('PAGE:', m.text()) })
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 120)))
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
await p.waitForTimeout(3000)
await p.evaluate(() => {
  const proxy = document.querySelector('.pm-table-clickproxy')
  window.__log = []
  if (proxy) {
    proxy.addEventListener('mousedown', e => window.__log.push('proxy-md@' + Math.round(e.clientX) + ',' + Math.round(e.clientY)), true)
    proxy.addEventListener('pointerdown', e => window.__log.push('proxy-pd'), true)
    // 也检查 hit-test：点击点 elementFromPoint
  } else window.__log.push('no-proxy')
})
const box = await p.evaluate(() => { const td = document.querySelector('td'); const r = td.getBoundingClientRect(); return { x: r.x + r.width * 0.7, y: r.y + r.height * 0.5 } })
// elementFromPoint 看谁在最上
const top = await p.evaluate(([x, y]) => {
  const el = document.elementFromPoint(x, y)
  return { tag: el?.tagName, cls: (el?.className || '').toString().slice(0, 30) }
}, [box.x, box.y])
console.log('点击点最上层:', JSON.stringify(top))
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(300)
console.log('事件日志:', JSON.stringify(await p.evaluate(() => window.__log)))
await b.close()
