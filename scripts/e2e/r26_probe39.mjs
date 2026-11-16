// 真实表格+真实CSS在干净页也活！→ 必须是「运行中的应用页面」的某个 JS
// 在起作用。回到应用页面：**杀掉所有 rAF/定时器后再点**！
// (分页引擎持续 recompute → PM updateState → ... )
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 120)))
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(800)
const buf = fs.readFileSync(DOC)
const form = new FormData()
form.append('file', new Blob([buf]), 'contract.docx')
const r = await fetch(BASE + '/api/doc/open', { method: 'POST', body: form })
const j = await r.json()
await p.evaluate(d => window.__setDocForTest(d), j.document)
await p.waitForTimeout(3500)
await p.evaluate(() => { [...document.querySelectorAll('.ProseMirror td')][2].scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(1000)

// 观察点击瞬间：是否有 rAF 风暴/事务循环。监测 500ms 内 rAF 次数与 PM dispatch 次数
const act = await p.evaluate(() => new Promise(resolve => {
  let rafN = 0
  const origRaf = window.requestAnimationFrame
  window.requestAnimationFrame = (cb) => origRaf(() => { rafN++; cb() })
  setTimeout(() => {
    window.requestAnimationFrame = origRaf
    resolve({ rafIn500ms: rafN })
  }, 500)
}))
console.log('activity:', JSON.stringify(act))

// 用 CDP Input domain 开启事件拦截诊断？不 —— 更直接：
// 试「真实鼠标的 trusted 事件」在 headful xvfb 里用 xdotool？没装。
// 试禁用 Chromium 平滑滚动/合成器相关 flag 的对照？太重。
// ★ 最后大招：在应用页面里【新建一个和 wrapper 并列的 tableWrapper 测试节点】
//（即 PM dom 里插第二个表格 —— 前面 probe21 的克隆是 fixed 的）。
// 这次直接 append 静态位置的表格在 PM 末尾，点击它：
const res = await p.evaluate(() => {
  const pm = window.__pmView.dom
  const td0 = [...document.querySelectorAll('.ProseMirror td')][2]
  const clone = td0.closest('.tableWrapper').cloneNode(true)
  pm.appendChild(clone) // 流内 append（非 fixed）
  window.__e = []
  window.addEventListener('pointerdown', () => window.__e.push(1), { capture: true, passive: true })
  const r = clone.getBoundingClientRect()
  return { top: Math.round(r.top), h: Math.round(r.height) }
})
console.log('clone appended at bottom (流内):', JSON.stringify(res))
// 滚到克隆处点击
await p.evaluate(() => { const wraps = [...document.querySelectorAll('.tableWrapper')]; wraps[wraps.length - 1].scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(600)
const box = await p.evaluate(() => {
  const wraps = [...document.querySelectorAll('.tableWrapper')]
  const r = wraps[wraps.length - 1].getBoundingClientRect()
  return { x: r.x + 30, y: r.y + 30 }
})
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(200)
console.log('流内 clone click →', (await p.evaluate(() => window.__e.length)) > 0 ? 'ALIVE' : 'DEAD')
await b.close()
