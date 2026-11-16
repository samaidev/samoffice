// proxy 已无 CE（新代码生效）但点击仍 from=1 —— mousedown 到底有没有到 proxy？
// dbg7 的朴素层能收，proxy 不能 —— 剩余差异：
// 1) proxy 有 className（pm-table-clickproxy）—— CSS 里有匹配规则？没有。
// 2) proxy 的 z-index:6 vs 朴素层 z-index:9 —— !!!
// 3) 朴素层有半透明背景，proxy 是 transparent —— ★ 透明背景 vs 半透明！
//    Chromium hit-test 对 fully-transparent 层 vs alpha>0 层处理不同
//    （透明层可能被「hit-testing 优化」跳过 —— 正是死区怪象的同胞 bug！）
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
// 给 proxy 加 1/255 透明度背景
const r1 = await p.evaluate(() => {
  const proxy = document.querySelector('.pm-table-clickproxy')
  proxy.style.background = 'rgba(0,0,0,0.004)'
  window.__log9 = []
  proxy.addEventListener('mousedown', () => window.__log9.push('proxy-md'), true)
  const r = proxy.getBoundingClientRect()
  return { x: r.x + r.width * 0.7, y: r.y + r.height * 0.5 }
})
await p.mouse.click(r1.x, r1.y)
await p.waitForTimeout(250)
console.log('alpha=0.004 背景后:', JSON.stringify(await p.evaluate(() => window.__log9)))
console.log('状态:', JSON.stringify(await p.evaluate(() => ({ from: window.__pmView.state.selection.from, focus: window.__pmView.hasFocus() }))))
await b.close()
