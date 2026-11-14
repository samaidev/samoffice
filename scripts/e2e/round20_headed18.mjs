// ★ 注意第 6 项之后的 DIV 链：`DIV. |pe=auto|pos=relative` —— pm-host！
// 它 position:relative 且【无宽度限制】(width:100%)。
// 但真正的重点是：TD pos=relative、TABLE pos=relative。
// Chromium 已知 bug：**position:relative 元素在 [transform: matrix() 容器] 内
// 且容器被滚动 (scrollTop) 时，原生 hit-test 与 JS hit-test 错位** ——
// elementFromPoint 走渲染管线（正确），鼠标事件派发走 compositor hit-test
// （用 stale layout）。
// 我们的场景：transform:matrix 缩放层（虽然 scale=1）+ 滚动容器 + relative td。
// 验证方法：把 transform 层移除后点击！
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const b = await chromium.launch({ args: ['--no-sandbox'], headless: false })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(15000)
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
const tryClick = async (label) => {
  await p.evaluate(() => { window.__hit = -1 })
  await p.mouse.click(309, 541)
  await p.waitForTimeout(200)
  const hit = await p.evaluate(() => window.__hit)
  console.log(`${label}: ${hit >= 0 ? '✓' : '✗'}`)
  return hit >= 0
}
await tryClick('基线')
// 1) 移除缩放层 transform
await p.evaluate(() => {
  const pm = document.querySelector('.ProseMirror')
  let n = pm
  while (n && n !== document.body) {
    if (getComputedStyle(n).transform !== 'none') { n.style.transform = 'none'; return 'removed' }
    n = n.parentElement
  }
  return 'notfound'
})
await p.waitForTimeout(300)
if (await tryClick('移除 transform 后')) console.log('>>> transform 层是罪魁')
// 2) 移除 td/table 的 relative
await p.evaluate(() => {
  document.querySelectorAll('.ProseMirror table, .ProseMirror table td, .ProseMirror table tr').forEach(el => { el.style.position = 'static' })
})
await p.waitForTimeout(300)
if (await tryClick('移除 table/td relative 后')) console.log('>>> relative 定位是罪魁')
await b.close()
