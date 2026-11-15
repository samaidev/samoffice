// transform/relative 都不是。回头看一个基本盲点：Playwright click 默认有
// actionability 等待 —— 若它认为目标点被【其他元素遮挡】会【自动滚动】或
// 【点击失败但不报错？】不 —— playwright click 不会静默失败，除非 force。
// 但 headed8 中点段落 ✓ 点表格 ✗ —— 同样的 mouse.click API！
// 
// 最后的最后：Chromium 的「无事件」或许因为 click 目标 SPAN 的祖先 TABLE
// 有【CSS resize/ro 属性】…… 不猜了。换 diviner 招数 ——
// page.mouse.click 改用 coordinates 内【第一个可接收事件的元素】：
// 直接用 elHandle.click()（Playwright 会自动等 actionable 并滚动）：
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const b = await chromium.launch({ args: ['--no-sandbox'], headless: false })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(20000)
const errs = []
p.on('pageerror', e => errs.push(e.message.slice(0, 100)))
await p.goto('http://localhost:18400', { waitUntil: 'networkidle' })
await p.evaluate(() => localStorage.setItem('samoffice_theme', 'light'))
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
const buf = fs.readFileSync(DOC)
const form = new FormData()
form.append('file', new Blob([buf]), 'contract.docx')
const r = await fetch('http://localhost:18400/api/doc/open', { method: 'POST', body: form })
const j = await r.json()
await p.evaluate(d => window.__setDocForTest(d), j.document)
await p.waitForTimeout(2500)
await p.evaluate(() => {
  const sc = document.querySelector('.flex-1.overflow-auto')
  const td = document.querySelector('.ProseMirror table td')
  const scRect = sc.getBoundingClientRect()
  const tdTop = td.getBoundingClientRect().top
  sc.scrollTop += tdTop - scRect.top - 300
})
await p.waitForTimeout(2500)
await p.evaluate(() => {
  window.__hit = -1
  window.addEventListener('mousedown', e => { window.__hit = Math.round(e.clientY) }, true)
})
// 用元素句柄 click（Playwright 内部走真实点击序列 + actionability 检查）
const tdHandle = await p.$('.ProseMirror table td')
try {
  await tdHandle.click({ timeout: 5000, position: { x: 20, y: 26 } })
  console.log('handle.click 执行完毕')
} catch (e) {
  console.log('handle.click 报错:', e.message.split('\n')[0])
}
await p.waitForTimeout(400)
const hit = await p.evaluate(() => window.__hit)
const focused = await p.evaluate(() => window.__pmView?.hasFocus?.())
console.log('事件:', hit >= 0 ? '✓ y=' + hit : '✗ 无', '| PM focus:', focused)
// 若 handle.click 也不行，看 Playwright 是否报 "element intercepts pointer events"
await b.close()
