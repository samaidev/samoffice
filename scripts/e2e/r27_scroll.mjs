// 滚动跟随验证 + 边框拖拽区不受影响 + 双表格
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 150)))
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
// 多表格文档
await p.evaluate(() => window.__setDocForTest({ meta: { title: 't' }, blocks: [
  { type: 'p', inline: [{ content: '段落一' }] },
  { type: 'table', rows: [
    [{ inline: [{ content: 'A1' }] }, { inline: [{ content: 'B1' }] }],
    [{ inline: [{ content: 'A2' }] }, { inline: [{ content: 'B2' }] }],
  ] },
  { type: 'p', inline: [{ content: '中间段落' }] },
  { type: 'table', rows: [
    [{ inline: [{ content: 'C1' }] }, { inline: [{ content: 'D1' }] }],
  ] },
  { type: 'p', inline: [{ content: '结尾' }] },
] }))
await p.waitForTimeout(3000)
const pb = await p.evaluate(() => { const r = document.querySelector('.ProseMirror p').getBoundingClientRect(); return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.5 } })
await p.mouse.click(pb.x, pb.y)
await p.waitForTimeout(2600)
const st = await p.evaluate(() => ({ proxies: document.querySelectorAll('.pm-table-clickproxy').length }))
console.log('代理数（应为2）:', st.proxies)
// 点击第二张表格
const box2 = await p.evaluate(() => { const tds = [...document.querySelectorAll('td')]; const r = tds[4].getBoundingClientRect(); return { x: r.x + r.width * 0.6, y: r.y + r.height * 0.5 } })
await p.mouse.click(box2.x, box2.y)
await p.waitForTimeout(600)
await p.keyboard.type('XY', { delay: 70 })
await p.waitForTimeout(400)
console.log('表2 td[4]:', JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('td')][4]?.textContent)))
// 滚动后点击第一张表（proxy 几何跟随）
await p.evaluate(() => { document.querySelector('.overflow-auto').scrollTop = 0 })
await p.waitForTimeout(800)
const box1 = await p.evaluate(() => { const r = document.querySelector('td').getBoundingClientRect(); return { x: r.x + r.width * 0.6, y: r.y + r.height * 0.5, vis: r.y > 0 && r.y < 880 } })
if (box1.vis) {
  await p.mouse.click(box1.x, box1.y)
  await p.waitForTimeout(600)
  await p.keyboard.type('R8', { delay: 70 })
  await p.waitForTimeout(400)
  console.log('回滚后表1 td[0]:', JSON.stringify(await p.evaluate(() => document.querySelector('td')?.textContent)))
}
// doc 完整
console.log('doc:', JSON.stringify(await p.evaluate(() => { const a = []; window.__pmView.state.doc.forEach(n => a.push(n.type.name)); return a })))
await b.close()
