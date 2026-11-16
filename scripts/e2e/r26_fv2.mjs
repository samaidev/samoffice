// 正式代码又 from=1 —— dbg15 的成功是在【旧 proxy 手动删除重建】后。
// 区别：dbg15 proxy 建于「页面已活 3s+」；正式代码 proxy 建于「挂载后 400ms」
// —— 还是太早？！或 HMR 未重载。检查 proxy 现状 + 用 dbg15 方式
//（删除+立即重建）在同页面对比：
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
await p.waitForTimeout(3500)
const info = await p.evaluate(() => {
  const proxy = document.querySelector('.pm-table-clickproxy')
  if (!proxy) return { exists: false }
  const r = proxy.getBoundingClientRect()
  return { exists: true, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
})
console.log('proxy:', JSON.stringify(info))
// 点击它试试（真实鼠标）
if (info.exists) {
  await p.evaluate(() => { window.__log = []; document.querySelector('.pm-table-clickproxy').addEventListener('mousedown', () => window.__log.push('md'), true) })
  await p.mouse.click(info.x + info.w * 0.6, info.y + info.h * 0.5)
  await p.waitForTimeout(400)
  console.log('mousedown 到达:', JSON.stringify(await p.evaluate(() => window.__log)))
  console.log('sel:', JSON.stringify(await p.evaluate(() => ({ from: window.__pmView.state.selection.from, focus: window.__pmView.hasFocus() }))))
}
await b.close()
