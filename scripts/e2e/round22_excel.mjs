// round22: Excel 编辑问题复现 —— 编辑A格→单击B格→编辑B格，A 格是否被清空
import { chromium } from 'playwright'
import fs from 'fs'
import { join } from 'path'
const SHOTS = join(process.cwd(), 'scripts/e2e/round19-shots')

// 生成一个简单 xlsx 测试文件（用 API 新建空表更快）
const b = await chromium.launch({ args: ['--no-sandbox'], headless: false })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(25000)
const errs = []
p.on('pageerror', e => errs.push(e.message.slice(0, 120)))
await p.goto('http://localhost:18400', { waitUntil: 'networkidle' })
await p.evaluate(() => localStorage.setItem('samoffice_theme', 'light'))
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
// 生成最小 xlsx 并通过 __setSheetForTest 正规流程打开
import { execSync } from 'child_process'
execSync(`python3 -c "
from openpyxl import Workbook
wb = Workbook()
ws = wb.active
ws['A1'] = 'init1'
ws['B1'] = 'init2'
wb.save('/tmp/round22_test.xlsx')
"`)
const setInput = await p.$('input[type=file]')
// __setSheetForTest 触发 input.click() —— Playwright 需先拦截文件选择
const chooserP = p.waitForEvent('filechooser', { timeout: 5000 })
await p.evaluate(() => { window.__setSheetForTest('t.xlsx') })
const chooser = await chooserP.catch(() => null)
if (chooser) await chooser.setFiles('/tmp/round22_test.xlsx')
await p.waitForTimeout(3000)

// 找到网格第一格（A1）位置
const grid = await p.evaluate(() => {
  const el = document.querySelector('[class*="grid"] table, table')
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: r.x + 60, y: r.y + 40 }
})
console.log('网格位置:', JSON.stringify(grid))
if (!grid) { console.log('未找到表格网格'); await b.close(); process.exit(1) }

// ===== 复现序列（单击编辑模型）=====
// 0) 定位 A1/B1 单元格中心（grid.x+60 是首列数据中心，+100 为 B 列）
const cellPos = await p.evaluate(() => {
  const table = document.querySelector('table')
  const dataRow = table?.querySelectorAll('tr')?.[1]
  const tds = dataRow?.querySelectorAll('td,th')
  const a = tds?.[1]?.getBoundingClientRect()
  const b = tds?.[2]?.getBoundingClientRect()
  return { a: { x: a.x + a.width / 2, y: a.y + a.height / 2 }, b: { x: b.x + b.width / 2, y: b.y + b.height / 2 } }
})
console.log('A1/B1 中心:', JSON.stringify(cellPos))
// 1) 单击 A1 → 应直接进入编辑 → 输入 AAA
await p.mouse.click(cellPos.a.x, cellPos.a.y)
await p.waitForTimeout(600)
await p.keyboard.type('AAA', { delay: 40 })
await p.waitForTimeout(300)
// 2) 不按 Enter —— 直接单击 B1（切格：A1 应自动提交，B1 进入编辑）
await p.mouse.click(cellPos.b.x, cellPos.b.y)
await p.waitForTimeout(600)
await p.keyboard.type('BBB', { delay: 40 })
await p.waitForTimeout(300)
// 3) 按 Enter 提交 B1
await p.keyboard.press('Enter')
await p.waitForTimeout(600)
// 5) 读取 A1/B1 的实际数据
const cells = await p.evaluate(() => {
  const table = document.querySelector('table')
  const rows = table?.querySelectorAll('tr')
  // rows[0]=列头(A,B,C..) rows[1]=数据行1。td[0]=行头。td[1]=A1 td[2]=B1
  const dataRow = rows?.[1]
  const tds = dataRow?.querySelectorAll('td,th')
  return { a1: tds?.[1]?.textContent?.trim(), b1: tds?.[2]?.textContent?.trim() }
})
console.log('单元格结果: A1="' + cells.a1 + '" B1="' + cells.b1 + '"')
console.log('A1 保留判定:', cells.a1 === 'AAA' ? 'PASS（A1 保留）' : 'FAIL（A1 被清空/丢失！值="' + cells.a1 + '"）')
await p.screenshot({ path: join(SHOTS, 'round22-excel.png') })
console.log('errors:', errs.slice(0, 3))
await b.close()
