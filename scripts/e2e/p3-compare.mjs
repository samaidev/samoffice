// p3-compare.mjs — 对照：网格 A1 vs 打印预览 A1 的样式
import { chromium } from 'playwright'

const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
await p.goto('http://localhost:18400', { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
await p.evaluate(() => { localStorage.setItem('samoffice_lang', 'zh') })
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
await p.locator('[data-testid="menu-files"]').click(); await p.waitForTimeout(400)
await p.locator('text=📊').first().click(); await p.waitForTimeout(900)
await p.locator('td[data-cell="0-0"]').click()
await p.keyboard.type('Header1'); await p.keyboard.press('Enter'); await p.waitForTimeout(200)
await p.locator('td[data-cell="0-1"]').click()
await p.keyboard.type('Data'); await p.keyboard.press('Enter'); await p.waitForTimeout(200)
await p.locator('td[data-cell="0-0"]').click()
await p.keyboard.press('Control+b'); await p.waitForTimeout(300)

const gridInfo = await p.evaluate(() => {
  const td = document.querySelector('td[data-cell="0-0"]')
  const span = td.querySelector('span')
  const cs = getComputedStyle(span || td)
  return { gridBold: cs.fontWeight }
})
console.log('grid A1:', JSON.stringify(gridInfo))

await p.locator('button', { hasText: '视图' }).first().click(); await p.waitForTimeout(300)
await p.locator('[data-testid="excel-print-btn"]').click(); await p.waitForTimeout(800)
await p.locator('[data-testid="print-dialog"]').screenshot({ path: '/home/z/my-project/samoffice/scripts/e2e/round51-shots/p3-dialog.png' })
const info = await p.evaluate(() => {
  const d = document.querySelector('[data-testid="print-dialog"]')
  const tds = Array.from(d.querySelectorAll('td,th'))
  return tds.slice(0, 20).map(td => ({ txt: td.textContent.slice(0, 12), fw: getComputedStyle(td).fontWeight, bg: getComputedStyle(td).backgroundColor }))
})
console.log('preview cells:', JSON.stringify(info))
await b.close()
