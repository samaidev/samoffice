// 好家伙 —— 任何 !important 覆盖都让它活（包括 min-height —— 但 min-height
// 只在 class 规则里）。真相：**覆盖任意属性 → 触发样式重算 → 合成层重建 → 活**。
// 而单纯去 class 也活。所以是「层状态损坏后不自我修复」—— 印证 compositor
// 层缓存 bug。真正触发损坏的源头仍未知，但已有一个可用的用户态修复模式！
// 验证假设：在文档加载后【强制一次 style 重算】（改任意属性再改回）能否
// 永久修复？如果可以 → 在 DocumentEditor 挂载/文档变化后 setTimeout 300ms
// 触发一次「强制重绘」即可修复所有用户场景！
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
// 死区确认
const clickTd = async () => {
  await p.evaluate(() => { window.__e = []; window.addEventListener('pointerdown', () => window.__e.push(1), { capture: true, passive: true }) })
  const box = await p.evaluate(() => { const r = [...document.querySelectorAll('.ProseMirror td')][2].getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(200)
  return (await p.evaluate(() => window.__e.length)) > 0
}
console.log('before:', await clickTd() ? 'ALIVE' : 'DEAD')
// 强制 style 重算（加一个无害属性再移除）
await p.evaluate(() => {
  const pm = window.__pmView.dom
  pm.style.setProperty('--r26-force', '1')
  void pm.offsetHeight
  pm.style.removeProperty('--r26-force')
  void pm.offsetHeight
})
await p.waitForTimeout(500)
console.log('after force recompute:', await clickTd() ? 'ALIVE' : 'DEAD')
// 如果不行，试 getComputedStyle 全量读取（强制 layout）+ preserve-3d 切换
await p.evaluate(() => {
  const pm = window.__pmView.dom
  pm.style.transform = 'translateZ(0)'
  void pm.offsetHeight
  requestAnimationFrame(() => { pm.style.transform = ''; void pm.offsetHeight })
})
await p.waitForTimeout(600)
console.log('after translateZ flush:', await clickTd() ? 'ALIVE' : 'DEAD')
await b.close()
