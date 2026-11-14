// PM 链：DIV z=1 (position:relative) 包裹一切 —— 但 final12 的临界
// tdY≈200 + paper层高 16842：纸页层 z=0 pe=none 无害。
// 
// 换最终务实策略：既然死区复杂难解（Chromium 合成器 bug），试试
// 【能否通过简单 CSS 干预修复】—— 候选：
// 1) .ProseMirror { contain: layout } —— 限层
// 2) 给 table 加 position:relative + z-index:1（提升为层内顶层）
// 3) 强制 GPU 光栅化关闭：#pr { will-change: auto }
// 4) 给 scroller 设 overscroll-behavior + isolation:isolate
// 逐个快速试：
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const b = await chromium.launch({ args: ['--no-sandbox'], headless: false })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(20000)
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
  window.__hit = -1
  window.addEventListener('mousedown', () => { window.__hit = 1 }, true)
  const sc = document.querySelector('.flex-1.overflow-auto')
  const td = document.querySelector('.ProseMirror table td')
  const scRect = sc.getBoundingClientRect()
  const tdTop = td.getBoundingClientRect().top
  sc.scrollTop += tdTop - scRect.top - 300
})
await p.waitForTimeout(2000)
const tryClick = async () => {
  await p.evaluate(() => { window.__hit = -1 })
  const box = await p.evaluate(() => {
    const td = document.querySelector('.ProseMirror table td')
    const r = td.getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  })
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(200)
  return (await p.evaluate(() => window.__hit)) >= 0
}
console.log('基线:', (await tryClick()) ? '✓' : '✗')
// 候选 1: table 加 position:relative + z-index
await p.evaluate(() => {
  document.querySelectorAll('.ProseMirror table').forEach(t => { t.style.position = 'relative'; t.style.zIndex = '5' })
})
await p.waitForTimeout(300)
if (await tryClick()) { console.log('✓✓ table z-index:5 修复!'); process.exit(0) }
// 候选 2: td 也加
await p.evaluate(() => {
  document.querySelectorAll('.ProseMirror table td').forEach(t => { t.style.position = 'relative'; t.style.zIndex = '5' })
})
await p.waitForTimeout(300)
if (await tryClick()) { console.log('✓✓ td z-index 修复!'); process.exit(0) }
// 候选 3: PM 加 contain
await p.evaluate(() => { document.querySelector('.ProseMirror').style.contain = 'layout' })
await p.waitForTimeout(300)
if (await tryClick()) { console.log('✓✓ contain:layout 修复!'); process.exit(0) }
// 候选 4: wrapper 加 isolation
await p.evaluate(() => { document.querySelector('.ProseMirror').style.isolation = 'isolate' })
await p.waitForTimeout(300)
if (await tryClick()) { console.log('✓✓ isolation 修复!'); process.exit(0) }
console.log('全部候选无效')
await b.close()
