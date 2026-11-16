// ★ 合成 mousedown → from=27 focus=true（代理代码工作正常！）
// 真实点击 → from=52（不同值！说明真实点击走了【别的路径】改了 selection
// —— 52 是第一次 cell 末尾？合成事件是 (r.x+20, r.y+20) 命中 cell0 开头
// 附近 → near→27。真实点击 (0.7w, 0.5h) 也该 cell0 末尾=52？
// from=52 = cellTextEnd(0,0) —— 就是代理层设置的值！
// 也就是说真实点击【确实触发了代理层逻辑】（from=52 正是预期）—— 
// 但 focus=false！合成时 focus=true。差异：真实点击后浏览器把 focus
// 移走（mousedown 的默认行为 —— 我们 preventDefault 了呀）…… 
// 除非 preventDefault 在 selection 之后…… 顺序：preventDefault 先。
// 真实点击 focus=false → keydown 不进编辑器 → 打字丢。
// 修：在 dispatch 后 focus() 之外，还要在 mouseup 后再 focus 一次
//（浏览器在 mouseup 后才最终确定焦点）。
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
// 在 proxy 上加 mouseup 补丁（测试假设）
await p.evaluate(() => {
  const proxy = document.querySelector('.pm-table-clickproxy')
  proxy.addEventListener('mouseup', () => { setTimeout(() => window.__pmView.focus(), 0) }, true)
})
const box = await p.evaluate(() => { const td = document.querySelector('td'); const r = td.getBoundingClientRect(); return { x: r.x + r.width * 0.7, y: r.y + r.height * 0.5 } })
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(350)
console.log('mouseup 补 focus 后:', JSON.stringify(await p.evaluate(() => ({ from: window.__pmView.state.selection.from, focus: window.__pmView.hasFocus() }))))
await p.keyboard.type('Q5', { delay: 60 })
await p.waitForTimeout(400)
console.log('td[0]:', JSON.stringify(await p.evaluate(() => document.querySelector('td')?.textContent)))
await b.close()
