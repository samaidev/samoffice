// 无 zoom。我重新审视「触摸活鼠标死」—— 触摸 tap 派发的是 touchstart，
// Playwright touchscreen.tap 不派发 mousedown（不合成鼠标）。
// 所以触摸结果只证明「主线程 hit-test 正常」。
// 鼠标死区 = wrapper 矩形 —— 在 body 克隆时可点。
// 在 PM 内 fixed 死 —— 但那是 probe21：target=HTML（事件派发了！但 target 是 HTML）
// probe21 与 probe22/26 的「无事件」矛盾！
// → 两种死法：(a) 无事件 (b) 事件 target=HTML。
// (b) 说明合成器把点击路由到了 HTML（绕过所有层）—— 典型的
// **"hit-test 用了过期的 layer 树"**（compositor frame lag）。
// 页面有持续的 scroll/重排 → rAF 循环（分页测量）持续提交新 frame →
// hit-test 层与最新 DOM 不匹配！
// 证据链闭环：TD 3 秒重建 31 次（probe 最初）！Chromium 合成器 hit-test
// 缓存在持续失效的层上 → 鼠标事件路由丢失。触摸 tap 走主线程 → 正常。
// 那 31 次重建哪来的？静置 3.5s 后 0 次（probe 后续）—— 但点击依然死！
// 所以不是持续 churn，而是**层在点击时已失效且未刷新**。
// 关键实验：强制合成器刷新 —— window.resize() 或改 scrollTop 1px 再改回，然后立即点击！
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
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
await p.waitForTimeout(1500)
const clickTd = async () => {
  await p.evaluate(() => { window.__e = []; window.addEventListener('pointerdown', () => window.__e.push(1), { capture: true, passive: true }) })
  const box = await p.evaluate(() => { const r = [...document.querySelectorAll('.ProseMirror td')][2].getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(200)
  return (await p.evaluate(() => window.__e.length)) > 0
}
console.log('baseline:', await clickTd() ? 'ALIVE' : 'dead')
// 强制合成器层失效+重建
await p.evaluate(() => {
  const sc = document.querySelector('.flex-1.overflow-auto')
  const st = sc.scrollTop
  sc.scrollTop = st + 2
  sc.scrollTop = st
  // 强制 style 重算 + repaint
  document.body.style.transform = 'translateZ(0)'
  requestAnimationFrame(() => { document.body.style.transform = '' })
})
await p.waitForTimeout(700)
console.log('after scroll-jiggle + body layer touch:', await clickTd() ? 'ALIVE' : 'dead')
// resize 触发
await p.evaluate(() => { window.dispatchEvent(new Event('resize')) })
await p.waitForTimeout(700)
console.log('after resize event:', await clickTd() ? 'ALIVE' : 'dead')
// DevTools 截图也强制重绘
await p.screenshot({ path: '/tmp/r26_force.png' })
await p.waitForTimeout(500)
console.log('after screenshot:', await clickTd() ? 'ALIVE' : 'dead')
await b.close()
