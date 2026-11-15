// 逐层隐藏法：依次隐藏可疑层，每次点击 (700,530) 看事件是否恢复
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const b = await chromium.launch({ args: ['--no-sandbox'] })
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
await p.waitForTimeout(2000)
await p.evaluate(() => {
  window.__hit = -1
  window.addEventListener('mousedown', e => { window.__hit = Math.round(e.clientY) }, true)
})
const tryClick = async (label) => {
  await p.evaluate(() => { window.__hit = -1 })
  await p.mouse.click(700, 530)
  await p.waitForTimeout(120)
  const hit = await p.evaluate(() => window.__hit)
  console.log(`${label}: ${hit >= 0 ? '✓ 事件到达' : '✗ 死区'}`)
  return hit >= 0
}
// 基线
await tryClick('基线')
// 逐层隐藏
const layers = [
  ['纸页层', 'div[style*="z-index: 0"]'],
  ['pg-paper', '.pg-paper'],
  ['comments-pane', '.comments-pane'],
  ['页脚层 footer', 'footer'],
  ['状态栏', '[data-testid="statusbar"]'],
]
for (const [name, sel] of layers) {
  const ok = await p.evaluate(sel => {
    const el = document.querySelector(sel)
    if (!el) return 'missing'
    el.style.display = 'none'
    return 'hidden'
  }, sel)
  if (ok === 'hidden') {
    const got = await tryClick(`隐藏${name}后`)
    if (got) { console.log('>>> 找到罪魁:', name); break }
  } else {
    console.log(name, '(不存在)')
  }
}
await b.close()
