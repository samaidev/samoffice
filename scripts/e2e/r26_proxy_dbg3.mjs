// ★★★ 新层（盖表格位置）事件正常！OVER-TABLE 收到了！
// 那为什么 .pm-table-clickproxy 收不到？？唯一区别：
// 我的调试层 z-index:7 vs proxy z-index:6 —— 不至于。
// 区别2：proxy 有 cursor:text + contenteditable=false 属性！
// 区别3：proxy 是 React HMR 之后 DocTableView 建的（代码链）vs 调试层是
// evaluate 建的。**代码没生效？**—— curl 确认过 attachClickProxy=3。
// 但 —— vite HMR 热替换后，页面上跑的还是【旧版 DocumentEditor】
//（React fast-refresh 对非组件导出的类更新不彻底）！reload 页面即可：
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
await p.waitForTimeout(3000)
// 检查页面上 proxy 的版本特征（新代码建的 proxy 应有 mousedown 响应）
const check = await p.evaluate(() => {
  const proxy = document.querySelector('.pm-table-clickproxy')
  if (!proxy) return { exists: false }
  // 手动触发 mousedown 看行为
  const r = proxy.getBoundingClientRect()
  const ev = new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: r.x + 20, clientY: r.y + 20, button: 0 })
  proxy.dispatchEvent(ev)
  return { exists: true, afterFrom: window.__pmView.state.selection.from, focus: window.__pmView.hasFocus() }
})
console.log('合成 mousedown 到 proxy:', JSON.stringify(check))
// 真实鼠标点击
const box = await p.evaluate(() => { const td = document.querySelector('td'); const r = td.getBoundingClientRect(); return { x: r.x + r.width * 0.7, y: r.y + r.height * 0.5 } })
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(350)
console.log('真实点击:', JSON.stringify(await p.evaluate(() => ({ from: window.__pmView.state.selection.from, focus: window.__pmView.hasFocus() }))))
await p.keyboard.type('Q5', { delay: 60 })
await p.waitForTimeout(400)
console.log('td[0]:', JSON.stringify(await p.evaluate(() => document.querySelector('td')?.textContent)))
await b.close()
