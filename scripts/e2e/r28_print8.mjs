// dlgOpen:false（.modal-overlay 不在 —— PrintDialog 用别的类名）但
// pm-nocaret DIV 有 187 子节点 = 预览渲染成功！之前 found:false 是
// 「t.closest('.ProseMirror')」把预览表格（现在有 ProseMirror 祖先）
// 误判为编辑器表格 —— 我的测试选择器错了。重新对比两者几何：
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 150)))
p.setDefaultTimeout(30000)
await p.goto(BASE + '/?r=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
const buf = fs.readFileSync(DOC)
const form = new FormData()
form.append('file', new Blob([buf]), 'contract.docx')
const r = await fetch(BASE + '/api/doc/open', { method: 'POST', body: form })
const j = await r.json()
await p.evaluate(d => window.__setDocForTest(d), j.document)
await p.waitForTimeout(4000)
// 编辑器表格基线
const ed = await p.evaluate(() => {
  const t = document.querySelector('.ProseMirror:not(.pm-nocaret) table')
  const w = t.closest('.tableWrapper')
  const r = t.getBoundingClientRect()
  const pmr = document.querySelector('.ProseMirror:not(.pm-nocaret)').getBoundingClientRect()
  const wr = w.getBoundingClientRect()
  return { w: Math.round(r.width), ml: getComputedStyle(w).marginLeft, mr: getComputedStyle(w).marginRight, centered: Math.abs((wr.left - pmr.left) - (pmr.right - wr.right)) < 12, layout: getComputedStyle(t).tableLayout }
})
console.log('编辑器表格:', JSON.stringify(ed))
// 打开预览
await p.evaluate(() => { const v = [...document.querySelectorAll('button')].find(t => t.textContent?.trim() === 'View'); v?.click() })
await p.waitForTimeout(600)
await p.evaluate(() => { document.querySelector('[data-testid=word-print-btn]')?.click() })
await p.waitForTimeout(2000)
const pv = await p.evaluate(() => {
  const host = document.querySelector('.pm-nocaret')
  if (!host) return { found: false }
  const t = host.querySelector('table')
  const w = t.closest('.tableWrapper')
  const cs = getComputedStyle(t)
  const wr = w.getBoundingClientRect()
  const hr = host.getBoundingClientRect()
  return {
    found: true,
    tableW: Math.round(t.getBoundingClientRect().width),
    layout: cs.tableLayout,
    wrapperML: getComputedStyle(w).marginLeft, wrapperMR: getComputedStyle(w).marginRight,
    wrapperLeftInHost: Math.round(wr.left - hr.left), hostW: Math.round(hr.width),
    centered: Math.abs((wr.left - hr.left) - (hr.right - wr.right)) < 12,
    border: cs.borderTopWidth,
  }
})
console.log('预览表格:', JSON.stringify(pv, null, 1))
// 视觉截图（预览区域）
await p.screenshot({ path: '/tmp/print_after.png' })
console.log('截图: /tmp/print_after.png')
await b.close()
