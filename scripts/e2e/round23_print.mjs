// 打印预览 E2E：打开该论文 docx（有跨页表格）→ 打印预览 → 检查预览 DOM 无分页位移残留
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(25000)
await p.goto('http://localhost:18400', { waitUntil: 'networkidle' })
await p.evaluate(() => localStorage.setItem('samoffice_theme', 'light'))
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(1000)
const buf = fs.readFileSync(DOC)
const form = new FormData()
form.append('file', new Blob([buf]), 'contract.docx')
const r = await fetch('http://localhost:18400/api/doc/open', { method: 'POST', body: form })
const j = await r.json()
await p.evaluate(d => window.__setDocForTest(d), j.document)
await p.waitForTimeout(5000)
// 打开打印预览：Ribbon 按钮可能在非激活 tab —— 遍历 tab 找到它
const btn = p.locator('[data-testid="word-print-btn"]')
if (await btn.count() === 0 || !(await btn.isVisible().catch(() => false))) {
  const tabs = p.locator('[role=tab], [class*=ribbon] [class*=tab], .tabs button')
  const n = await tabs.count().catch(() => 0)
  for (let i = 0; i < Math.min(n, 12); i++) {
    await tabs.nth(i).click().catch(() => {})
    await p.waitForTimeout(300)
    if (await btn.isVisible().catch(() => false)) break
  }
}
await p.click('[data-testid="word-print-btn"]')
await p.waitForTimeout(1500)
const diag = await p.evaluate(() => {
  const dlg = document.querySelector('[data-testid="print-dialog"]')
  if (!dlg) return { open: false }
  // 预览区域检查
  const pv = dlg.querySelector('.overflow-auto, [style*="transform"]')
  const html = pv ? pv.innerHTML : ''
  return {
    open: true,
    hasPgBrkClass: html.includes('pg-brk'),
    hasTransformY: /transform:\s*translateY/.test(html),
    hasBigMargin: /margin-top:\s*[2-9]\d{2}/.test(html),
    tableCount: (html.match(/<table/g) || []).length,
    previewLen: html.length,
  }
})
console.log('打印预览状态:', JSON.stringify(diag))
if (!diag.open) { console.log('预览未打开 FAIL'); await b.close(); process.exit(1) }
const pass = !diag.hasPgBrkClass && !diag.hasTransformY && !diag.hasBigMargin && diag.tableCount > 0
console.log('检查:', pass ? 'PASS（无分页位移残留，表格在预览中）' : 'FAIL（有残留）',
  `类残留=${diag.hasPgBrkClass} transform=${diag.hasTransformY} 大margin=${diag.hasBigMargin} 表格数=${diag.tableCount}`)
// 截图存档
await p.screenshot({ path: 'scripts/e2e/round19-shots/round23-print-preview.png' })
await b.close()
