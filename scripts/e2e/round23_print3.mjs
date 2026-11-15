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
await p.click('[data-testid="ribbon-tab-view"]')
await p.waitForTimeout(400)
await p.click('[data-testid="word-print-btn"]')
await p.waitForTimeout(2000)
const check = await p.evaluate(() => {
  const dlg = document.querySelector('[data-testid="print-dialog"]')
  const tbl = dlg?.querySelector('table')
  if (!tbl) return { table: false }
  const cs = getComputedStyle(tbl)
  const firstTd = tbl.querySelector('td')
  const tdStyle = firstTd ? getComputedStyle(firstTd) : null
  const wrapper = tbl.closest('.tableWrapper')
  return {
    table: true,
    collapse: cs.borderCollapse,
    tableW: Math.round(tbl.getBoundingClientRect().width),
    rows: tbl.querySelectorAll('tr').length,
    tdBorderBottom: tdStyle?.borderBottomWidth + ' ' + tdStyle?.borderBottomStyle,
    tdBorderRight: tdStyle?.borderRightWidth + ' ' + tdStyle?.borderRightStyle,
    wrapperMarginBottom: wrapper ? getComputedStyle(wrapper).marginBottom : 'n/a',
    wrapperTransform: wrapper ? getComputedStyle(wrapper).transform : 'n/a',
    // 编辑器里的表格对照
    editorTbl: (() => {
      const t2 = document.querySelector('.ProseMirror table')
      if (!t2) return null
      return { collapse: getComputedStyle(t2).borderCollapse, w: Math.round(t2.getBoundingClientRect().width) }
    })(),
  }
})
console.log(JSON.stringify(check, null, 1))
await b.close()
