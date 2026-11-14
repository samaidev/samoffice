// round19: 中国区域 .doc — 在正确的滚动容器里截图全部 8 个表格
// 注意：滚动会触发分页装饰 → DOM 重建 → elementHandle 失效，所以每轮重新按索引查询 + clip 截图
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

const SHOTS = join(process.cwd(), 'scripts/e2e/round19-shots')
mkdirSync(SHOTS, { recursive: true })
const DOC = '/home/z/my-project/upload/中国区域碳排放影响因素研究20160509.doc'

async function main() {
  const browser = await chromium.launch({ args: ['--no-sandbox'] })
  const page = await (await browser.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
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
  await page.evaluate(d => window.__setDocForTest(d), j.document)
  await page.waitForTimeout(2500)

  const n = await page.evaluate(() => document.querySelectorAll('table').length)
  console.log('tables:', n)
  const summary = []
  for (let i = 0; i < n; i++) {
    // 滚动容器内部滚动到表格
    await page.evaluate(idx => {
      const t = document.querySelectorAll('table')[idx]
      t.scrollIntoView({ block: 'start' })
    }, i)
    await page.waitForTimeout(600)
    const box = await page.evaluate(idx => {
      const t = document.querySelectorAll('table')[idx]
      const r = t.getBoundingClientRect()
      return { x: Math.max(0, r.x - 30), y: Math.max(0, r.y - 30), width: Math.min(r.width + 60, 1340), height: Math.min(r.height + 60, 860) }
    }, i)
    await page.screenshot({ path: join(SHOTS, `doc2-table-${i}.png`), clip: box })
    const info = await page.evaluate(idx => {
      const t = document.querySelectorAll('table')[idx]
      const rows = t.rows.length
      const cells = t.querySelectorAll('td,th').length
      const ts = getComputedStyle(t)
      const first = t.querySelector('td,th')
      const cs = first ? getComputedStyle(first) : null
      // 检查"表格最外侧边框"：第一行首格的上/左 + 最后一行末格的下/右
      const lastRow = t.rows[t.rows.length - 1]
      const lastCell = lastRow ? lastRow.cells[lastRow.cells.length - 1] : null
      const lcs = lastCell ? getComputedStyle(lastCell) : null
      return {
        rows, cells,
        borderCollapse: ts.borderCollapse,
        firstCell: cs ? { top: cs.borderTopStyle, left: cs.borderLeftStyle, w: cs.borderTopWidth } : null,
        lastCell: lcs ? { bottom: lcs.borderBottomStyle, right: lcs.borderRightStyle } : null,
      }
    }, i)
    summary.push({ i, ...info })
  }
  console.log(JSON.stringify(summary, null, 1))
  writeFileSync(join(SHOTS, 'doc2-border-summary.json'), JSON.stringify(summary, null, 2))
  await browser.close()
}
main().catch(e => { console.error('ERR:', e); process.exit(1) })
