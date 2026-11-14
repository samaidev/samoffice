// 页面内所有层都排除了。这几乎肯定是 Chromium/Playwright 层面的问题。
// 大胆最后一试：也许 (700,530) 处是【第二个显示器/窗口外】？headless 只有一屏。
// 或者 —— 检查是否有 <dialog>/<popover> 顶层元素：
// TIP layer (top-layer) 不在 DOM 树里 —— elementFromPoint 能看到 dialog
// 但 elementsFromPoint 包含 top-layer。之前堆栈没看到。
// 用另一种验证：键盘能不能用？Tab 聚焦表格区域 + 打字 —— 若键盘可以编辑，
// 则问题纯属【鼠标 hit-test 层】，用户真实环境（非 headless）可能没有这个问题！
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(15000)
const errs = []
p.on('pageerror', e => errs.push(e.message.slice(0, 100)))
await p.goto('http://localhost:18400', { waitUntil: 'networkidle' })
await p.evaluate(() => localStorage.setItem('samoffice_theme', 'light'))
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
const buf = fs.readFileSync(DOC)
const form = new FormData()
form.append('file', new Blob([buf]), 'contract.docx')
const r = await fetch('http://localhost:18400/api/doc/open', { method: 'POST', body: form })
const j = await r.json()
await p.evaluate(d => window.__setDocForTest(d), j.document)
await p.waitForTimeout(2500)
// 用 PM API 直接设置光标到表格单元格 + 键盘输入（绕过鼠标）
const editOk = await p.evaluate(() => {
  const pm = window.__pmView
  // 找第一个 table_cell 的第一个段落位置
  let cellPos = -1
  pm.state.doc.descendants((node, pos) => {
    if (cellPos < 0 && node.type.name === 'table_cell') cellPos = pos
    return cellPos < 0
  })
  if (cellPos < 0) return { ok: false, why: 'no cell' }
  // 光标放进格内段落
  const $cell = pm.state.doc.resolve(cellPos + 1)
  const tr = pm.state.tr.setSelection(pm.state.tr.selection.constructor.near($cell))
  pm.dispatch(tr)
  pm.focus()
  return { ok: true, from: pm.state.selection.from }
})
console.log('API 设置光标:', JSON.stringify(editOk))
await p.keyboard.type('K', { delay: 40 })
await p.waitForTimeout(400)
const txt = await p.evaluate(() => {
  let cellText = ''
  window.__pmView.state.doc.descendants((node, pos) => {
    if (!cellText && node.type.name === 'table_cell') {
      cellText = node.textContent.slice(0, 10)
    }
    return !cellText
  })
  return cellText
})
console.log('键入K后首格文本:', JSON.stringify(txt), txt.includes('K') ? 'KEYBOARD-EDIT-OK' : 'KEYBOARD-EDIT-FAIL')
console.log('errors:', errs.slice(0, 2))
await b.close()
