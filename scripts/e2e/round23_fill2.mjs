// fill handle 全场景 E2E v2：累加/复制/多格序列（1,3→5,7）/文本循环/横向填充
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
ws['A1'] = '1'
ws['A2'] = '3'
ws['B1'] = 'hello'
wb.save('/tmp/fill_test2.xlsx')
"`)
const chooserP = p.waitForEvent('filechooser', { timeout: 5000 })
await p.evaluate(() => { window.__setSheetForTest('t.xlsx') })
const chooser = await chooserP.catch(() => null)
if (chooser) await chooser.setFiles('/tmp/fill_test2.xlsx')
await p.waitForTimeout(2500)
const cellPos = (r, c) => p.evaluate(({ r, c }) => {
  const tds = document.querySelector('table')?.querySelectorAll('tr')?.[r + 1]?.querySelectorAll('td,th')
  const x = tds?.[c + 1]?.getBoundingClientRect()
  return { x: x.x + x.width / 2, y: x.y + x.height / 2, w: x.width, h: x.height }
}, { r, c })
const handlePos = () => p.evaluate(() => {
  const el = document.querySelector('[data-fill-handle]')
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: r.x + 2, y: r.y + 2 }
})
const readCol = (r1, r2, c) => p.evaluate(({ r1, r2, c }) => {
  const rows = document.querySelector('table')?.querySelectorAll('tr')
  const out = []
  for (let i = r1; i <= r2; i++) out.push(rows?.[i + 1]?.querySelectorAll('td,th')?.[c + 1]?.textContent?.trim())
  return out
}, { r1, r2, c })
const dragDown = async (from, steps) => {
  const h = await handlePos()
  await p.mouse.move(h.x, h.y)
  await p.mouse.down()
  for (let i = 1; i <= steps; i++) { await p.mouse.move(from.x, from.y + i * 22, { steps: 3 }); await p.waitForTimeout(60) }
  await p.mouse.up()
  await p.waitForTimeout(600)
}
// ===== 1) 多格序列：A1=1,A2=3 → 选中两格下拉 → 5,7 =====
let a1 = await cellPos(0, 0), a2 = await cellPos(1, 0)
await p.mouse.click(a1.x, a1.y)   // 单击=编辑
await p.keyboard.press('Escape')  // 退出编辑 → 选中态
await p.waitForTimeout(200)
// shift 点 A2 扩展选区
await p.keyboard.down('Shift'); await p.mouse.click(a2.x, a2.y); await p.keyboard.up('Shift')
await p.waitForTimeout(300)
let hv = await handlePos()
if (!hv) { console.log('1) 多选 handle: ✗ 不显示'); }
else {
  await dragDown(a2, 2)
  const v = await readCol(2, 3, 0)
  console.log('1) 序列 1,3 下拉→A3,A4 =', v.join(','), v[0] === '5' && v[1] === '7' ? '✓' : '✗')
}
// ===== 2) 文本循环：B1=hello 下拉 =====
let b1 = await cellPos(0, 1)
await p.mouse.click(b1.x, b1.y)
await p.keyboard.press('Escape')
await p.waitForTimeout(200)
await dragDown(b1, 2)
const v2 = await readCol(1, 2, 1)
console.log('2) 文本 hello 下拉→B2,B3 =', v2.join(','), v2[0] === 'hello' && v2[1] === 'hello' ? '✓' : '✗')
// ===== 3) 横向累加：A1=1 选右拉 =====
a1 = await cellPos(0, 0)
await p.mouse.click(a1.x, a1.y)
await p.keyboard.press('Escape')
await p.waitForTimeout(200)
const h = await handlePos()
await p.mouse.move(h.x, h.y)
await p.mouse.down()
for (let i = 1; i <= 2; i++) { await p.mouse.move(a1.x + i * 90, a1.y, { steps: 3 }); await p.waitForTimeout(60) }
await p.mouse.up()
await p.waitForTimeout(600)
const v3 = await p.evaluate(() => {
  const tds = document.querySelector('table')?.querySelectorAll('tr')?.[1]?.querySelectorAll('td,th')
  return [1, 2, 3].map(i => tds?.[i]?.textContent?.trim())
})
console.log('3) A1=1 右拉→B1,C1 =', v3.join(','), v3[1] === '2' && v3[2] === '3' ? '✓' : '✗')
// ===== 4) 编辑态 handle 隐藏不影响（单击编辑流程正常） =====
await p.mouse.click(a1.x, a1.y)
await p.waitForTimeout(400)
const hasInput = await p.evaluate(() => !!document.querySelector('td input, td textarea'))
console.log('4) 单击仍可编辑:', hasInput ? '✓' : '✗')
await b.close()
