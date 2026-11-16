// 最小结构活。逐步加料：contenteditable、ProseMirror 类、pg-paper 层、
// pm-host padding、表格 NodeView 手柄、装饰 —— 直到死。
import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
await p.goto('about:blank')

const BASE_HTML = `
<div id="sc" class="flex-1 overflow-auto" style="height:600px;overflow:auto;position:relative;z-index:1">
  <div id="pageRef" class="mx-auto" style="position:relative;margin-top:24px;margin-bottom:24px;width:794px;overflow:visible">
    <div id="scaler" style="width:794px;transform-origin:top center">
      <div id="sheets" style="position:absolute;inset:0;z-index:0;pointer-events:none">
        <div class="pg-paper" style="position:absolute;top:0;left:0;width:794px;height:1123px;background:#fff"></div>
      </div>
      <div id="pmhost" style="width:100%;padding:96px 96px 96px 96px;position:relative">
        <div id="pm" class="ProseMirror" contenteditable="true" style="position:relative;white-space:pre-wrap">
          <div style="height:2000px"></div>
          <div id="wrap" class="tableWrapper" style="position:relative">
            <div class="pm-table-handle" style="position:absolute;left:-9px;top:-1px;width:18px;height:18px;display:none"></div>
            <table class="pm-table" style="border-collapse:collapse;margin:8px 0;table-layout:fixed;width:554px;position:relative">
              <colgroup><col style="width:180px"><col style="width:180px"><col style="width:194px"></colgroup>
              <tbody>
                <tr><td style="height:52px;position:relative"><p><span>参数</span></p></td><td><p><span>模拟值</span></p></td><td><p><span>步长</span></p></td></tr>
                <tr><td style="height:52px"><p><span>P</span></p></td><td><p><span>0.5</span></p></td><td><p><span>1.5</span></p></td></tr>
              </tbody>
            </table>
          </div>
          <div style="height:14000px"></div>
        </div>
      </div>
    </div>
  </div>
</div>`

await p.evaluate(h => { document.body.innerHTML = h }, BASE_HTML)
await p.evaluate(() => {
  // 模拟分页断点装饰：表格上方插一个 pg-linebreak
  const brk = document.createElement('span')
  brk.className = 'pg-linebreak'
  brk.style.marginTop = '500px'
  const pm = document.getElementById('pm')
  const wrap = document.getElementById('wrap')
  pm.insertBefore(brk, wrap)
  const td = document.querySelector('td')
  td.scrollIntoView({ block: 'center' })
  window.__e = []
  window.addEventListener('pointerdown', () => window.__e.push(1), { capture: true, passive: true })
})
await p.waitForTimeout(600)
const box = await p.evaluate(() => { const r = document.querySelector('td').getBoundingClientRect(); return { x: r.x + 20, y: r.y + 20, vis: r.y > 0 && r.y < 900 } })
console.log('box:', JSON.stringify(box))
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(200)
console.log('with break decoration →', (await p.evaluate(() => window.__e.length)) > 0 ? 'ALIVE' : 'DEAD')
await b.close()
