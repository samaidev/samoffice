// from=52/54/9615 —— 点击+光标全部正确（td 各自内容位）！
// 但 txt 还是原值 —— 打字仍没进。from=52 而非 25 —— 
// ★ 25 是 cell 开头 —— 52 是……cell 末尾？td[0] cell 内容 "A1"：
// cellStart=23 → 内容 24-26。52 = 第一个 cell 的【末尾】？不 ——
// 52 = pos 末段落附近。管理器 target=cellStart+1=24 → near(24,1)=25。
// 实测 from=52 —— near 没给 25！
// ★★★ 但 t10 里 near(23,1)/near(24,1)/near(25,1) 全=25！
// 唯一不同：现在点击时【鼠标在格上】—— PM 的原生 selection 事务
// 后于我们 dispatch（我们的 setTimeout(0) 先跑，PM 原生后跑覆盖成 52）
// —— mouseup 阻止了？我们 mouseup preventDefault —— 在 proxy 上。
// PM 原生收不到 mousedown（被 proxy 拦）—— 那 52 从哪来？
// ★ 52 恰是【第二个 cell B1 的 cellStart+内容+1】？B1 cellStart=26,
// 内容 27-29 —— 不是。52 = 表格后段落 pos51+1 = 段落内第一位！
// ◆ PM 把 caret 放末段落 —— 因为 DOM selection anchor=P（末段落）。
// 【我们的 DOM-sel 同步代码没跑或又被覆盖】—— addRange 劫持为空。
// 时序：我们的 setTimeout(0) 内：dispatch(25) → focus() → setRange(td)
// → 之后 PM 的 selectionToDOM 监听 selectionchange（我们 setRange 触发）
// → PM 读 DOM selection（td 文本 range）→ 同步 PM state from=?? 
// PM 对非 PM 管理位置的处理…… 最终 52 = 某次往返的结果。
// ★ 破局：不打 DOM selection 主意 —— 学 r26_last 成功路径：
// 那次【无任何鼠标事件】纯 evaluate 设 selection(25)+focus → 打字进格。
// 区别：无点击 → 无原生 caret。现在点击存在 → 原生 caret 总在之后。
// ★★ 修：mouseup 之后再做一次 setSelection+focus+setRange（三连）
//   —— 即 setTimeout(0) 改 setTimeout(30)（等原生 mouseup 完全结束）：
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
await p.waitForTimeout(3000)
const pb = await p.evaluate(() => { const r = document.querySelector('.ProseMirror p').getBoundingClientRect(); return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.5 } })
await p.mouse.click(pb.x, pb.y)
await p.waitForTimeout(2600)
// 覆盖产品延时：手动模拟「mouseup 后 50ms 应用」+ 观察时序
await p.evaluate(() => {
  window.__seq = []
  const proxy = document.querySelector('.pm-table-clickproxy')
  // 记录产品 setTimeout(0) 的效果，然后 60ms 后补刀
  const origDispatch = window.__pmView.dispatch.bind(window.__pmView)
})
const box = await p.evaluate(() => { const r = document.querySelector('td').getBoundingClientRect(); return { x: r.x + r.width * 0.6, y: r.y + r.height * 0.5 } })
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(200)
// 在原生 mouseup 后 60ms（此刻产品 setTimeout(0) 已跑完被覆盖成 52），
// 手动重放 r26_last 成功三连：
await p.evaluate(() => {
  const v = window.__pmView
  let pos = -1
  v.state.doc.forEach((n, off) => { if (pos < 0 && n.type.name === 'table') pos = off })
  const target = pos + 4 // cell0 内容开头附近
  v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.near(v.state.doc.resolve(target), 1)))
  v.focus()
})
await p.waitForTimeout(120)
console.log('补刀后 from:', await p.evaluate(() => window.__pmView.state.selection.from), 'focus:', await p.evaluate(() => window.__pmView.hasFocus()))
await p.keyboard.type('Q5', { delay: 70 })
await p.waitForTimeout(400)
console.log('td[0]:', JSON.stringify(await p.evaluate(() => document.querySelector('td')?.textContent)))
await b.close()
