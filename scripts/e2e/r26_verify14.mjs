// white-space: normal → ALIVE；line-height 改变 → ALIVE。
// 但 font-family/min-height 改变 → DEAD（这两个改变不触发行布局变化？）
// white-space:normal 与 line-height 改变都会**改变文本行盒布局**！
// → 修复的真正机制 = 「重新排版」而非「样式重算」！
// 这就是为什么 !important 碰到布局相关属性才活。
// ★ 联想到 Chromium 已知 bug：**超大高度 contenteditable 的 compositor
// scroll hit-test 区域缓存**。重新布局后失效重建。
// 那触发损坏的源头是什么？很可能：**文档加载后 PM 内容高度变化
// （17k px）+ editorScroll 的滚动条出现** 造成的层缓存错位。
// 用户态修复方案（工程上稳妥）：加载文档后强制一次「无害重排」：
// 临时改 line-height 或 white-space，两帧后还原 —— 布局两次、视觉零变化。
// 先验证两帧还原后是否仍然活（还原会不会把 bug 带回来）：
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1000)
const buf = fs.readFileSync(DOC)
const form = new FormData()
form.append('file', new Blob([buf]), 'contract.docx')
const r = await fetch(BASE + '/api/doc/open', { method: 'POST', body: form })
const j = await r.json()
await p.evaluate(d => window.__setDocForTest(d), j.document)
await p.waitForTimeout(4000)
await p.evaluate(() => { [...document.querySelectorAll('.ProseMirror td')][2].scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(1000)
const clickTd = async () => {
  await p.evaluate(() => { window.__e = []; window.addEventListener('pointerdown', () => window.__e.push(1), { capture: true, passive: true }) })
  const box = await p.evaluate(() => { const r = [...document.querySelectorAll('.ProseMirror td')][2].getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(200)
  return (await p.evaluate(() => window.__e.length)) > 0
}
console.log('before:', await clickTd() ? 'ALIVE' : 'DEAD')
// 无害重排：line-height 微调 → 两帧 → 还原
const ok = await p.evaluate(() => new Promise(resolve => {
  const pm = window.__pmView.dom
  pm.style.setProperty('line-height', '1.801', 'important')
  void pm.offsetHeight
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      pm.style.removeProperty('line-height')
      void pm.offsetHeight
      setTimeout(() => resolve(true), 300)
    })
  })
}))
console.log('relayout done:', ok)
console.log('after relayout cycle:', await clickTd() ? 'ALIVE ✅' : 'DEAD')
await b.close()
