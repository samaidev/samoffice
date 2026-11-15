// round23: fill handle E2E —— 单击选中（不进编辑？—— 单击会进编辑！）
// 注意：round22 改了单击=编辑 —— fill handle 需在【选中未编辑】状态显示。
// Excel 交互：单击选中→显示 handle；我们单击=编辑 → handle 显示条件 !editCell
// —— 但单击直接进编辑 → handle 消失。交互矛盾！
// —— 方案：编辑态也显示 handle（Excel 单击选中即有 handle；我们单击编辑时
//    光标在 input —— handle 仍应可拖）。先测当前实现：
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
ws['B1'] = '3'
ws['C1'] = 'hello'
wb.save('/tmp/fill_test.xlsx')
"`)
const chooserP = p.waitForEvent('filechooser', { timeout: 5000 })
await p.evaluate(() => { window.__setSheetForTest('t.xlsx') })
const chooser = await chooserP.catch(() => null)
if (chooser) await chooser.setFiles('/tmp/fill_test.xlsx')
await p.waitForTimeout(2500)
const pos = async () => p.evaluate(() => {
  const tds = document.querySelector('table')?.querySelectorAll('tr')?.[1]?.querySelectorAll('td,th')
  const r = (i) => { const x = tds?.[i]?.getBoundingClientRect(); return { x: x.x + x.width / 2, y: x.y + x.height / 2, right: x.x + x.width - 2, bottom: x.y + x.height - 2 } }
  return { a: r(1), b: r(2), c: r(3), a2: null }
})
let P = await pos()
// 单击 A1（进入编辑态）→ 看 handle 是否存在
await p.mouse.click(P.a.x, P.a.y)
await p.waitForTimeout(600)
let handle = await p.evaluate(() => !!document.querySelector('[data-fill-handle]'))
console.log('1) 编辑态 handle 显示:', handle ? '✓' : '✗（编辑态隐藏了 handle）')
// Escape 退出编辑 → handle 应显示
await p.keyboard.press('Escape')
await p.waitForTimeout(300)
handle = await p.evaluate(() => !!document.querySelector('[data-fill-handle]'))
console.log('2) 非编辑态 handle 显示:', handle ? '✓' : '✗')
if (!handle) { console.log('中止：无 handle'); await b.close(); process.exit(1) }
// ===== 测试 A：A1=1 下拉 3 格 → 2,3,4 =====
const h = await p.evaluate(() => { const el = document.querySelector('[data-fill-handle]'); const r = el.getBoundingClientRect(); return { x: r.x + 2, y: r.y + 2 } })
await p.mouse.move(h.x, h.y)
await p.mouse.down()
for (let i = 1; i <= 3; i++) {
  await p.mouse.move(P.a.x, P.a.y + i * 22, { steps: 3 })
  await p.waitForTimeout(80)
}
await p.mouse.up()
await p.waitForTimeout(700)
let vals = await p.evaluate(() => {
  const tds = document.querySelector('table')?.querySelectorAll('tr')
  return [1, 2, 3, 4].map(i => tds?.[i]?.querySelectorAll('td,th')?.[1]?.textContent?.trim())
})
console.log('3) A1=1 下拉3格:', vals.join(','), JSON.stringify(vals) === JSON.stringify(['1','2','3','4']) ? '✓ 累加' : '✗')
// ===== 测试 B：Ctrl 拖拽 = 纯复制 =====
// 选中 A1（click+escape 同上）
await p.mouse.click(P.a.x, P.a.y)
await p.keyboard.press('Escape')
await p.waitForTimeout(250)
const h2 = await p.evaluate(() => { const el = document.querySelector('[data-fill-handle]'); const r = el.getBoundingClientRect(); return { x: r.x + 2, y: r.y + 2 } })
await p.keyboard.down('Control')
await p.mouse.move(h2.x, h2.y)
await p.mouse.down()
for (let i = 1; i <= 2; i++) { await p.mouse.move(P.a.x, P.a.y + i * 22, { steps: 3 }); await p.waitForTimeout(80) }
await p.mouse.up()
await p.keyboard.up('Control')
await p.waitForTimeout(700)
vals = await p.evaluate(() => {
  const tds = document.querySelector('table')?.querySelectorAll('tr')
  return [3, 4, 5].map(i => tds?.[i]?.querySelectorAll('td,th')?.[1]?.textContent?.trim())
})
console.log('4) Ctrl 拖拽纯复制 A3:A5:', vals.join(','), JSON.stringify(vals) === JSON.stringify(['3','3','3']) ? '✓' : '✗')
await b.close()
