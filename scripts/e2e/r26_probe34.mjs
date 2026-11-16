// 全部无效。时间宝贵，换极简复现策略：从零构建最小页面 ——
// body > div(contenteditable) > tableWrapper > table > tr > td > p>span，
// 高度 17000px 滚动容器 —— 点击表格。如果死 → Chromium/环境 bug 确认，
// 与 SamOffice 代码无关；如果活 → 用二分法把 SamOffice 的结构/样式
// 逐块搬进来直到死掉。
import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
await p.goto('about:blank')
const build = (html) => p.evaluate(h => { document.body.innerHTML = h }, html)
await build(`
<div id="sc" style="height:600px;overflow:auto">
  <div style="height:2000px"></div>
  <div id="wrap" class="tableWrapper" style="position:relative">
    <table class="pm-table" style="border-collapse:collapse;width:554px;table-layout:fixed">
      <colgroup><col style="width:180px"><col style="width:180px"><col style="width:194px"></colgroup>
      <tbody>
        <tr><td style="height:52px"><p><span>参数</span></p></td><td><p><span>模拟值</span></p></td><td><p><span>步长</span></p></td></tr>
        <tr><td style="height:52px"><p><span>P</span></p></td><td><p><span>0.5</span></p></td><td><p><span>1.5</span></p></td></tr>
      </tbody>
    </table>
  </div>
  <div style="height:14000px"></div>
</div>`)
await p.evaluate(() => {
  const td = document.querySelector('td')
  td.scrollIntoView({ block: 'center' })
  window.__e = []
  window.addEventListener('pointerdown', () => window.__e.push(1), { capture: true, passive: true })
})
await p.waitForTimeout(600)
const box = await p.evaluate(() => { const r = document.querySelector('td').getBoundingClientRect(); return { x: r.x + 20, y: r.y + 20 } })
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(200)
console.log('minimal repro →', (await p.evaluate(() => window.__e.length)) > 0 ? 'ALIVE' : 'DEAD')
await b.close()
