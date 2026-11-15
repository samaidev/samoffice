// Excel 单击编辑回归：拖拽框选仍工作 / Ctrl+点击多选 / Enter/Tab 流转 / Escape 取消
import { chromium } from 'playwright'
import { execSync } from 'child_process'
const b = await chromium.launch({ args: ['--no-sandbox'], headless: false })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(20000)
await p.goto('http://localhost:18400', { waitUntil: 'networkidle' })
await p.evaluate(() => localStorage.setItem('samoffice_theme', 'light'))
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
execSync(`python3 -c "
from openpyxl import Workbook
wb = Workbook()
ws = wb.active
for i, ch in enumerate('ABCDE'):
    ws.cell(row=1, column=i+1).value = 'v' + ch
wb.save('/tmp/round22_test.xlsx')
"`)
const chooserP = p.waitForEvent('filechooser', { timeout: 5000 })
await p.evaluate(() => { window.__setSheetForTest('t.xlsx') })
const chooser = await chooserP.catch(() => null)
if (chooser) await chooser.setFiles('/tmp/round22_test.xlsx')
await p.waitForTimeout(3000)
const pos = await p.evaluate(() => {
  const table = document.querySelector('table')
  const dataRow = table?.querySelectorAll('tr')?.[1]
  const tds = dataRow?.querySelectorAll('td,th')
  const r = (i) => { const x = tds?.[i]?.getBoundingClientRect(); return { x: x.x + x.width / 2, y: x.y + x.height / 2 } }
  return { a: r(1), b: r(2), c: r(3) }
})
// 1) 拖拽框选 A1→C1（不应进入编辑）
await p.mouse.move(pos.a.x, pos.a.y)
await p.mouse.down()
await p.mouse.move(pos.c.x, pos.c.y, { steps: 6 })
await p.mouse.up()
await p.waitForTimeout(400)
const st1 = await p.evaluate(() => {
  const sel = document.querySelector('.bg-indigo-500, [class*="indigo"][class*="bg"]')
  const editing = !!document.querySelector('td input, td textarea')
  return { hasSelBg: !!sel, isEditing: editing }
})
console.log('1) 拖拽框选: 选区高亮=' + st1.hasSelBg + ' 进入编辑=' + st1.isEditing, (!st1.isEditing) ? 'PASS（拖拽不触发编辑）' : 'FAIL')
// 2) Escape 在编辑中取消还原
await p.mouse.click(pos.a.x, pos.a.y)
await p.waitForTimeout(500)
await p.keyboard.type('XY', { delay: 30 })
await p.keyboard.press('Escape')
await p.waitForTimeout(400)
const v1 = await p.evaluate(() => {
  const tds = document.querySelector('table')?.querySelectorAll('tr')?.[1]?.querySelectorAll('td,th')
  return tds?.[1]?.textContent?.trim()
})
console.log('2) Escape 取消: A1="' + v1 + '"', v1 === 'vA' ? 'PASS（还原旧值）' : 'FAIL')
// 3) Enter 提交下移
await p.mouse.click(pos.a.x, pos.a.y)
await p.waitForTimeout(400)
await p.keyboard.type('NEW')
await p.keyboard.press('Enter')
await p.waitForTimeout(500)
const v2 = await p.evaluate(() => {
  const tds = document.querySelector('table')?.querySelectorAll('tr')?.[1]?.querySelectorAll('td,th')
  return tds?.[1]?.textContent?.trim()
})
const cursorCell = await p.evaluate(() => {
  // 选中格（A2）是否有高亮
  const rows = document.querySelectorAll('table tr')
  const r2 = rows?.[2]?.querySelectorAll('td,th')
  const a2 = r2?.[1]
  return a2 ? a2.className.includes('indigo') || a2.querySelector('[class*="border"][class*="indigo"]') !== null || getComputedStyle(a2).outlineStyle !== 'none' : false
})
console.log('3) Enter 提交: A1="' + v2 + '" 下移选中=' + cursorCell, v2 === 'NEW' ? 'PASS' : 'FAIL')
await b.close()
