// 滚动到表格区后检查 PM 编辑器状态
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const b = await chromium.launch({ args: ['--no-sandbox'], headless: false })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(25000)
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
await p.waitForTimeout(3500)
const check = async (label) => {
  const st = await p.evaluate(() => {
    const pm = window.__pmView
    const sel = pm.state.selection
    const node = sel.$from.node()
    // 检查当前选区所在位置类型
    let inProtect = false
    pm.state.doc.nodesBetween(sel.from, sel.to, n => { if (n.type.name === 'text_box' || n.attrs?.locked) inProtect = true; return true })
    return {
      editable: pm.editable,
      focused: pm.hasFocus(),
      selFrom: sel.from,
      selEmpty: sel.empty,
      blockType: node?.type?.name,
      inProtect,
      docReadonly: window.__docReadonly,
      protected: window.__docProtected,
    }
  })
  console.log(label, JSON.stringify(st))
}
await check('初始:')
await p.evaluate(() => { const sc = document.querySelector('.flex-1.overflow-auto'); if (sc) sc.scrollTo({ top: 10230 }) })
await p.waitForTimeout(1000)
await check('滚动到表格区:')
// 点击段落
const pt = await p.evaluate(() => {
  for (const el of document.querySelectorAll('.ProseMirror p')) {
    const r = el.getBoundingClientRect()
    if (r.y > 150 && r.y < 750 && el.textContent.trim().length > 5) return { x: r.x + 80, y: r.y + r.height / 2, text: el.textContent.slice(0, 10) }
  }
  return null
})
console.log('点击目标:', JSON.stringify(pt))
await p.mouse.click(pt.x, pt.y)
await p.waitForTimeout(400)
await check('点击后:')
// 键盘 Tab 键入 PM（模拟焦点获得）
await p.evaluate(() => window.__pmView.focus())
await p.waitForTimeout(200)
await check('手动 focus 后:')
const len1 = await p.evaluate(() => window.__pmView.state.doc.textContent.length)
await p.keyboard.type('Q', { delay: 40 })
await p.waitForTimeout(300)
const len2 = await p.evaluate(() => window.__pmView.state.doc.textContent.length)
console.log('手动focus后输入:', len1, '→', len2, len2 > len1 ? 'OK' : 'FAIL')
await b.close()
