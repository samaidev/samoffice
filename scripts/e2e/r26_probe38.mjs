// 回放真实表格 HTML + 真实 CSS 于 about:blank
import { chromium } from 'playwright'
import fs from 'fs'
const extract = JSON.parse(fs.readFileSync('/tmp/r26_extract.json', 'utf8'))
const b = await chromium.launch({ args: ['--no-sandbox'] })
// 1) 从 app 拿 CSS
const pa = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
await pa.goto('http://localhost:18400', { waitUntil: 'domcontentloaded' })
const cssText = await pa.evaluate(async () => {
  const res = await fetch(document.querySelector('link[rel=stylesheet]')?.href || '/src/index.css')
  return res.text()
})
const p2 = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
await p2.goto('about:blank')
const alive = await p2.evaluate(([css, wrapperHTML, hostStyle]) => {
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st)
  const html = `
  <div class="flex flex-col h-screen overflow-x-hidden" style="height:900px;overflow:hidden">
   <main class="flex-1 overflow-hidden min-h-0 flex">
    <div class="flex-1 overflow-hidden min-w-0">
     <div class="flex flex-col h-full" style="position:relative">
      <div style="flex:1 1 auto;display:flex;min-height:0;flex-direction:column">
       <div id="sc" class="flex-1 overflow-auto" style="position:relative;z-index:1;display:flex;align-items:flex-start;justify-content:center">
        <div id="pageRef" class="mx-auto" style="position:relative;margin-top:24px;width:794px">
         <div id="scaler" style="width:794px;transform-origin:top center">
          <div style="position:absolute;inset:0;z-index:0;pointer-events:none"></div>
          <div id="pmhost" style="${hostStyle}">
           <div id="pm" class="ProseMirror" contenteditable="true">
            <div style="height:2000px"></div>
            ${wrapperHTML}
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
  document.body.innerHTML = html
  const td = [...document.querySelectorAll('td')][2]
  td.scrollIntoView({ block: 'center' })
  window.__e = []
  window.addEventListener('pointerdown', () => window.__e.push(1), { capture: true, passive: true })
  const r = td.getBoundingClientRect()
  window.__box = { x: r.x + r.width * 0.6, y: r.y + r.height * 0.5 }
  return true
}, [cssText, extract.wrapperHTML, extract.hostStyle])
await p2.waitForTimeout(800)
const box = await p2.evaluate(() => window.__box)
await p2.mouse.click(box.x, box.y)
await p2.waitForTimeout(200)
console.log('real table replay →', (await p2.evaluate(() => window.__e.length)) > 0 ? 'ALIVE' : 'DEAD')
await b.close()
