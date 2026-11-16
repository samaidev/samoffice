// 仍然活。加载真实 CSS（vite 的 index.css）再试 —— 样式定罪
import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
await p.goto('http://localhost:18400', { waitUntil: 'domcontentloaded' })
// 拿到 app 的样式表链接并提取 CSS 文本
const cssText = await p.evaluate(async () => {
  const res = await fetch(document.querySelector('link[rel=stylesheet]')?.href || '/src/index.css')
  return res.text()
})
// 开 about:blank 注入同样的结构 + 真实 CSS
const p2 = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
await p2.goto('about:blank')
await p2.evaluate(([css]) => {
  const st = document.createElement('style')
  st.textContent = css
  document.head.appendChild(st)
}, [cssText])
const BASE_HTML = `
<div class="flex flex-col h-screen overflow-x-hidden" style="height:900px;overflow:hidden">
 <main class="flex-1 overflow-hidden min-h-0 flex">
  <div class="flex-1 overflow-hidden min-w-0">
   <div class="flex flex-col h-full" style="position:relative">
    <div style="flex:1 1 auto;display:flex;min-height:0;flex-direction:column">
     <div id="sc" class="flex-1 overflow-auto" style="position:relative;z-index:1;display:flex;align-items:flex-start;justify-content:center;background:#eef">
      <div id="pageRef" class="mx-auto" style="position:relative;margin-top:24px;width:794px;overflow:visible">
       <div id="scaler" style="width:794px;transform-origin:top center">
        <div style="position:absolute;inset:0;z-index:0;pointer-events:none"></div>
        <div id="pmhost" style="width:100%;padding:96px;position:relative">
         <div id="pm" class="ProseMirror" contenteditable="true">
          <div style="height:2000px"></div>
          <div id="wrap" class="tableWrapper">
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
     </div>
    </div>
   </div>
  </div>
 </main>
</div>`
await p2.evaluate(h => { document.body.innerHTML = h }, BASE_HTML)
await p2.evaluate(() => {
  const td = document.querySelector('td')
  td.scrollIntoView({ block: 'center' })
  window.__e = []
  window.addEventListener('pointerdown', () => window.__e.push(1), { capture: true, passive: true })
})
await p2.waitForTimeout(700)
const box = await p2.evaluate(() => { const r = document.querySelector('td').getBoundingClientRect(); return { x: r.x + 20, y: r.y + 20 } })
await p2.mouse.click(box.x, box.y)
await p2.waitForTimeout(200)
console.log('with real app CSS →', (await p2.evaluate(() => window.__e.length)) > 0 ? 'ALIVE' : 'DEAD')
await b.close()
