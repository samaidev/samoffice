// from 回到 1 —— mouseup 后 focus 被【再次】抢走 + selection 被重置！
// 有东西在 mouseup/click 阶段重置 selection。嫌疑：PM 的 DOMObserver
// selectionchange 处理（读到 DOM selection 在别处 → 同步回 PM state → 
// from=1）。DOM selection 没在我们的 td 里（死区也影响 DOM selection
// 的设置 —— syncProxyGeometry 后 window.getSelection().collapse(td) 也
// 可能不被合成器接受？—— selection 不是 hit-test，应该正常）。
// 完整方案（对齐 scheme5 成功路径）：mousedown 里同时设置
// DOM Selection（collapse 到 td 文本末尾）+ PM selection + focus。
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
await p.evaluate(() => {
  const proxy = document.querySelector('.pm-table-clickproxy')
  proxy.addEventListener('mouseup', () => {
    const v = window.__pmView
    // PM selection 已在 mousedown 设好 —— 这里只重设 DOM selection + focus
    const sel = window.getSelection()
    const td = document.querySelector('td')
    const findText = (el) => { for (const n of el.childNodes) { if (n.nodeType === 3) return n; const r = findText(n); if (r) return r } return null }
    const t = findText(td)
    if (t && sel) {
      const range = document.createRange()
      range.setStart(t, t.length)
      range.collapse(true)
      sel.removeAllRanges()
      sel.addRange(range)
    }
    v.focus()
  }, true)
})
const box = await p.evaluate(() => { const td = document.querySelector('td'); const r = td.getBoundingClientRect(); return { x: r.x + r.width * 0.7, y: r.y + r.height * 0.5 } })
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(400)
console.log('完整补丁后:', JSON.stringify(await p.evaluate(() => ({ from: window.__pmView.state.selection.from, focus: window.__pmView.hasFocus(), anchor: window.getSelection()?.anchorNode?.nodeName }))))
await p.keyboard.type('Q5', { delay: 60 })
await p.waitForTimeout(400)
console.log('td[0]:', JSON.stringify(await p.evaluate(() => document.querySelector('td')?.textContent)))
await b.close()
