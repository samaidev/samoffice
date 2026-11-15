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
// 打印按钮在【视图】tab（3567 行 ribbonTab === 'view' 区块）
await p.click('[data-testid="ribbon-tab-view"]')
await p.waitForTimeout(500)
await p.click('[data-testid="word-print-btn"]')
await p.waitForTimeout(2000)
const info = await p.evaluate(() => {
  const dlg = document.querySelector('[data-testid="print-dialog"]')
  if (!dlg) return { open: false }
  // 找所有 transform 容器（预览页）
  const pages = dlg.querySelectorAll('[style*="transform"]')
  const out = []
  pages.forEach((pg, i) => {
    if (i < 4) out.push({ i, len: pg.innerHTML.length, tables: (pg.innerHTML.match(/<table/g) || []).length, text: pg.textContent.slice(0, 40) })
  })
  return { open: true, pages: out, dlgLen: dlg.innerHTML.length }
})
console.log(JSON.stringify(info, null, 1))
await p.screenshot({ path: 'scripts/e2e/round19-shots/round23-print-preview.png' })
await b.close()
