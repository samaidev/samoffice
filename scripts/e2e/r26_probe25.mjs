// CDP 两个点都返回节点（backendNodeId 16/17）—— DOM 层面命中正常！
// 所以事件派发链（Input.dispatchMouseEvent → hit-test → 事件）在 DOM 层 OK，
// 但 JS 没收到 → **事件被派发到了另一个 frame/上下文**！
// frameId 相同。那只剩一种可能：**PointerEvent 被 "pointerrawupdate"/
// 事件拦截器（capture 阶段的 CDP 或 DevTools protocol EventListener）吞了**……
// 不。再想：elementFromPoint OK + CDP hit-test OK + JS 无事件 =
// 事件根本没派发或被 Browser 端丢弃。
// Input.dispatchMouseEvent 返回 {} 成功。Playwright 的 click 也是 CDP。
// ★ 但注意：Playwright click 用的坐标 = viewport 坐标。Chromium 内部把
// viewport 坐标转为"渲染表面坐标"时用了 deviceScaleFactor + 页面缩放。
// 此页 dsf=1。
// —— 换一条全新验证路径：直接读 PM 的 mousedown 是否通过「模拟真实触摸」触发：
// Input.dispatchTouchEvent 触摸事件走完全不同的管线！
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 }, hasTouch: true }))
const p2 = await (await b.newContext({ viewport: { width: 1360, height: 900 }, hasTouch: true })).newPage()
await p2.goto(BASE, { waitUntil: 'networkidle' })
await p2.waitForTimeout(800)
const buf = fs.readFileSync(DOC)
const form = new FormData()
form.append('file', new Blob([buf]), 'contract.docx')
const r = await fetch(BASE + '/api/doc/open', { method: 'POST', body: form })
const j = await r.json()
await p2.evaluate(d => window.__setDocForTest(d), j.document)
await p2.waitForTimeout(3500)
await p2.evaluate(() => { [...document.querySelectorAll('.ProseMirror td')][2].scrollIntoView({ block: 'center' }) })
await p2.waitForTimeout(1500)
const box = await p2.evaluate(() => {
  const r = [...document.querySelectorAll('.ProseMirror td')][2].getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
await p2.evaluate(() => { window.__tp = []; ['pointerdown','touchstart','mousedown'].forEach(ev => window.addEventListener(ev, e => window.__tp.push(ev + ':' + (e.target.tagName || '')), { capture: true, passive: true })) })
// tap via touchscreen
await p2.touchscreen.tap(box.x, box.y)
await p2.waitForTimeout(300)
console.log('touch events:', JSON.stringify(await p2.evaluate(() => window.__tp)))
await b.close()
