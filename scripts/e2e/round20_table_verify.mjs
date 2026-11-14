// round20: 死循环修复后的表格编辑全量验证
// 1) 静置无事务 2) 表格 DOM 稳定 3) 单元格点击可编辑 4) Ctrl+A 全选 5) 跨格拖选 + 加粗
import { chromium } from 'playwright'
import { join } from 'path'
import { mkdirSync } from 'fs'

const SHOTS = join(process.cwd(), 'scripts/e2e/round19-shots')
mkdirSync(SHOTS, { recursive: true })
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'

async function main() {
  const browser = await chromium.launch({ args: ['--no-sandbox'] })
  const page = await (await browser.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
  page.setDefaultTimeout(20000)
  const errors = []
  page.on('pageerror', e => errors.push(e.message.slice(0, 120)))
  await page.goto('http://localhost:18400', { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.setItem('samoffice_theme', 'light'))
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)

  const fs = await import('fs')
  const buf = fs.readFileSync(DOC)
  const form = new FormData()
  form.append('file', new Blob([buf]), 'contract.docx')
  const r = await fetch('http://localhost:18400/api/doc/open', { method: 'POST', body: form })
  const j = await r.json()
  await page.evaluate(d => window.__setDocForTest(d), j.document)
  await page.waitForTimeout(2500)

  // ===== 1. 静置事务计数 =====
  await page.evaluate(() => {
    const pm = window.__pmView
    window.__trCount = 0
    const orig = pm.dispatch.bind(pm)
    pm.dispatch = (tr) => { window.__trCount++; return orig(tr) }
  })
  await page.waitForTimeout(3500)
  const idleTrs = await page.evaluate(() => window.__trCount)
  console.log('1) 静置3.5s事务数:', idleTrs, idleTrs <= 1 ? 'PASS' : 'FAIL')

  // ===== 2. 表格 DOM 稳定性 =====
  await page.evaluate(() => {
    document.querySelector('.ProseMirror table td').setAttribute('data-probe', '1')
    window.__probeGone = 0
    window.__probeTimer = setInterval(() => { if (!document.querySelector('[data-probe]')) window.__probeGone++ }, 100)
  })
  await page.evaluate(() => document.querySelector('.ProseMirror table').scrollIntoView({ block: 'center' }))
  await page.waitForTimeout(2500)
  const probe = await page.evaluate(() => { clearInterval(window.__probeTimer); return { gone: window.__probeGone, alive: !!document.querySelector('[data-probe]') } })
  console.log('2) 滚动后2.5s表格重建次数:', probe.gone, probe.gone === 0 && probe.alive ? 'PASS' : 'FAIL')

  // ===== 3. 单元格点击编辑 =====
  const cell = await page.$('.ProseMirror table td p')
  await cell.scrollIntoViewIfNeeded()
  await page.waitForTimeout(600)
  const box = await cell.boundingBox()
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(400)
  const focusOk = await page.evaluate(() => window.__pmView.hasFocus())
  await page.keyboard.type('OK', { delay: 40 })
  await page.waitForTimeout(300)
  const cellText = await page.evaluate(() => document.querySelector('.ProseMirror table td p')?.textContent)
  const editOk = focusOk && cellText && cellText.includes('OK')
  console.log('3) 单元格点击编辑: focus=' + focusOk + ' 文本="' + cellText + '"', editOk ? 'PASS' : 'FAIL')
  // 撤销输入
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(200)

  // ===== 4. Ctrl+A 全选 =====
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(300)
  await page.keyboard.press('Control+a')
  await page.waitForTimeout(400)
  const selInfo = await page.evaluate(() => {
    const s = window.__pmView.state.selection
    return { from: s.from, to: s.to, full: s.to - s.from > 1000, type: s.constructor.name }
  })
  console.log('4) Ctrl+A 全选: ' + selInfo.from + '-' + selInfo.to, selInfo.full ? 'PASS' : 'FAIL')

  // ===== 5. 跨格拖选 + 加粗 =====
  // 拖选：从第一个格中心拖到第三格
  const cells = await page.$$('.ProseMirror table tr:first-child td')
  const c0 = await cells[0].boundingBox()
  const c1 = await cells[Math.min(2, cells.length - 1)].boundingBox()
  await page.mouse.move(c0.x + c0.width / 2, c0.y + c0.height / 2)
  await page.mouse.down()
  await page.mouse.move(c1.x + c1.width / 2, c1.y + c1.height / 2, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(400)
  const dragSel = await page.evaluate(() => {
    const s = window.__pmView.state.selection
    const isCell = typeof s.isColSelection === 'function' && typeof s.isRowSelection === 'function' && !s.isRowSelection?.() || s.constructor.name === 'CellSelection'
    return { isCellSel: s.constructor.name === 'CellSelection', from: s.from, to: s.to }
  })
  await page.keyboard.press('Control+b')
  await page.waitForTimeout(400)
  const boldCount = await page.evaluate(() => document.querySelectorAll('.ProseMirror table td strong, .ProseMirror table td [style*="bold"], .ProseMirror table td font-weight\\:bold').length)
  console.log('5) 跨格拖选(C=' + dragSel.isCellSel + ')加粗格数:', boldCount, (dragSel.isCellSel || dragSel.to > dragSel.from + 10) && boldCount > 0 ? 'PASS' : 'FAIL')
  await page.screenshot({ path: join(SHOTS, 'tbl-fix-verify.png') })

  // 撤销加粗
  await page.keyboard.press('Control+z')
  console.log('pageerrors:', errors.slice(0, 3))
  await browser.close()
}
main().catch(e => { console.error('ERR:', e); process.exit(1) })
