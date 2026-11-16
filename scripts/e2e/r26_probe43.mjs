// ★★★★★ 锁定！死区边界：scaler(含)以下死，pageRef(不含 scaler)以上活。
// scaler 是 <div style="width:794px; transform:scale(1); transform-origin:top center">
// transform:scale(1)（即使恒等）创建 stacking context + containing block for fixed！
// 早前 probe30 改 transform=none 时拿到的是 pm-host.parentElement —— 但当时
// 打印 hadTransform="" —— 说明 scaler 的 style.transform 是【内联 style 属性】
// 通过 React style 设置 —— probe30 读 scaler.style.transform 得到 ""？
// React 用 style.transform = 'scale(1)' 应该能读到。重新读！并测：把 scaler
// 的 transform 真正去掉（用 setAttribute 或 cssText），点击
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
await p.waitForTimeout(1200)
const info = await p.evaluate(() => {
  const host = window.__pmView.dom.parentElement       // pm-host
  const scaler = host.parentElement                     // scaler
  return {
    attr: scaler.getAttribute('style'),
    propTransform: scaler.style.transform,
    csTransform: getComputedStyle(scaler).transform,
  }
})
console.log('scaler style:', JSON.stringify(info))
// 强制去 transform（React 稍后可能覆盖 —— 立即点击）
const box = await p.evaluate(() => {
  const scaler = window.__pmView.dom.parentElement.parentElement
  scaler.style.setProperty('transform', 'none', 'important')
  const td = [...document.querySelectorAll('.ProseMirror td')][2]
  window.__e = []
  window.addEventListener('pointerdown', e => window.__e.push(e.target.tagName), { capture: true, passive: true })
  const r = td.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
await p.waitForTimeout(400)
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(200)
console.log('scaler transform:none!important →', JSON.stringify(await p.evaluate(() => window.__e)))
await b.close()
