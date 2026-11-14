// 关键测试：探针消失但表格数=1 且 firstTd 还是"参数"（同一表格内容）→
// 不是克隆，是【PM 重渲染了 td 并丢了自定义属性】。PM 的 Decoration 或
// setNodeMarkup 会重建 td。触发时机：scrollIntoView → 分页引擎测量（pg-measuring）
// → 分页重算 → 表格 NodeView 重建。
// 真正要确认的：点击现在能不能用！这是最终目标。属性丢失只是表象。
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

// 滚动后等待足够久（分页重算完成后）
await p.evaluate(() => document.querySelector('.ProseMirror table').scrollIntoView({ block: 'center' }))
await p.waitForTimeout(3000)  // 等分页彻底稳定

// 直接用 PM API 定位点击坐标（不依赖 playwright 的元素句柄）
const cellBox = await p.evaluate(() => {
  const td = document.querySelector('.ProseMirror table td')
  td.setAttribute('data-probe', '1')
  const r2 = td.getBoundingClientRect()
  return { x: r2.x + r2.width / 2, y: r2.y + r2.height / 2 }
})
console.log('点击坐标:', JSON.stringify(cellBox))
await p.mouse.click(cellBox.x, cellBox.y)
await p.waitForTimeout(400)
const st1 = await p.evaluate(() => {
  const pm = window.__pmView
  return { focused: pm.hasFocus(), from: pm.state.selection.from, probeAlive: !!document.querySelector('[data-probe]') }
})
console.log('点击后:', JSON.stringify(st1))
await p.keyboard.type('OK', { delay: 40 })
await p.waitForTimeout(400)
const st2 = await p.evaluate(() => document.querySelector('.ProseMirror table td')?.textContent)
console.log('键入OK后:', JSON.stringify(st2), st2?.includes('OK') ? 'EDIT-OK' : 'EDIT-FAIL')
console.log('errors:', errs.slice(0, 2))
await b.close()
