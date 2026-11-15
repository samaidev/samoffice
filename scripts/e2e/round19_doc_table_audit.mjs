// round19: 中国区域 .doc 打开 → 表格边框审计 + 截图
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

const SHOTS = join(process.cwd(), 'scripts/e2e/round19-shots')
mkdirSync(SHOTS, { recursive: true })
const DOC = '/home/z/my-project/upload/中国区域碳排放影响因素研究20160509.doc'

async function main() {
  const browser = await chromium.launch({ args: ['--no-sandbox'] })
  const page = await (await browser.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message.slice(0, 120)))

  await page.goto('http://localhost:18400', { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.setItem('samoffice_theme', 'light'))
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1000)

  const fs = await import('fs')
  const buf = fs.readFileSync(DOC)
  const form = new FormData()
  form.append('file', new Blob([buf]), 'china.doc')
  const r = await fetch('http://localhost:18400/api/doc/open', { method: 'POST', body: form })
  const j = await r.json()
  if (!j.document) { console.error('OPEN FAILED', JSON.stringify(j).slice(0, 300)); process.exit(1) }
  await page.evaluate(d => window.__setDocForTest(d), j.document)
  await page.waitForTimeout(2500)

  // 表格审计：每个表格的行列数、单元格边框计算样式
  const audit = await page.evaluate(() => {
    const tables = Array.from(document.querySelectorAll('table'))
    return tables.map((t, ti) => {
      const cells = Array.from(t.querySelectorAll('td, th'))
      const noBorder = cells.filter(c => {
        const s = getComputedStyle(c)
        // 四边都无可见边框
        const sides = [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth]
        return sides.every(w => parseFloat(w) === 0)
      }).length
      // 采样第一个单元格四边
      const first = cells[0]
      const s = first ? getComputedStyle(first) : null
      return {
        ti,
        rows: t.rows.length,
        cells: cells.length,
        noBorderCells: noBorder,
        sampleBorder: s ? [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth].map(parseFloat) : null,
        borderColor: s ? s.borderTopColor : null,
      }
    })
  })
  console.log('tables:', JSON.stringify(audit, null, 1))
  writeFileSync(join(SHOTS, 'doc2-table-audit.json'), JSON.stringify(audit, null, 2))

  // 滚动截图整篇文档（找表格所在页）
  const H = await page.evaluate(() => document.body.scrollHeight)
  const screens = Math.min(Math.ceil(H / 850), 16)
  for (let s = 0; s < screens; s++) {
    await page.evaluate(y => window.scrollTo(0, y), s * 850)
    await page.waitForTimeout(300)
    await page.screenshot({ path: join(SHOTS, `doc2-p${String(s).padStart(2, '0')}.png`) })
  }
  console.log('doc2 screens:', screens, 'pageHeight:', H)
  console.log('pageerrors:', errors.slice(0, 3))
  await browser.close()
}
main().catch(e => { console.error('ERR:', e); process.exit(1) })
