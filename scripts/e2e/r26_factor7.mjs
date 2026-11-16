// 静置 0 变动。死区与时间无关、静态可复现于应用、但静态回放同 DOM 不复现。
// → 回放与应用的差异在【DOM 之外的浏览器状态】：
// ★ 页面历史！应用页经历了 SPA 状态（关于页 → 文档页），布局树经历了
// 多次完整重建 —— compositor 层从旧布局遗留。about:blank 一步到位。
// 决定性实验：reload 后【跳过关于页直接进入文档】？不行，钩子在 App 里。
// 换：reload 页面 → 立刻 __setDocForTest → 点击。若 reload 后仍死 →
// 与历史无关（每次 fresh 状态都死）→ 那"静态回放活"只能解释为
// 【iframe-less 但 isolate 的 document】本身不同（about:blank vs vite 页）。
// 用 data: URL 或 srcdoc 复制 vite 页？太绕。
// ★★★ 直接在【应用页面】操作：删除 #root 里编辑器之外的一切 DOM + 
// 停掉 React（不可能）—— 但可以对比「应用页面 reload 后立即注入静态结构」：
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1000)
// 不开文档！直接在 body 末尾注入与 factor2 相同的静态结构（复用其 CSS）
const res = await p.evaluate(() => {
  const sc = document.querySelector('.flex-1.overflow-auto') // 关于页无编辑器 —— 构造假容器
  const html = `<div class="flex-1 overflow-auto" style="height:700px;overflow:auto;position:relative;z-index:1;display:flex;align-items:flex-start;justify-content:center">
    <div class="mx-auto" style="position:relative;margin-top:24px;width:794px">
      <div style="width:794px">
        <div style="width:100%;padding:96px;position:relative">
          <div class="ProseMirror" contenteditable="true">
            <div class="tableWrapper">
              <table class="pm-table" style="border-collapse:collapse;margin:8px 0;table-layout:fixed;width:554px;position:relative">
                <colgroup><col style="width:277px"><col style="width:277px"></colgroup>
                <tbody><tr><td style="height:52px;position:relative"><p><span>A1</span></p></td><td style="height:52px;position:relative"><p><span>B1</span></p></td></tr></tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>`
  const wrap = document.createElement('div')
  wrap.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#fff'
  wrap.innerHTML = html
  document.body.appendChild(wrap)
  window.__e = 0
  window.addEventListener('pointerdown', () => window.__e++, { capture: true, passive: true })
  const td = wrap.querySelector('td')
  const r = td.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
await p.mouse.click(res.x, res.y)
await p.waitForTimeout(250)
console.log('应用页(关于态)+注入静态表:', (await p.evaluate(() => window.__e)) > 0 ? 'ALIVE ✅' : 'DEAD')
await b.close()
