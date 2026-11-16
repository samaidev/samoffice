// 复现用户场景：多页文档 + 表格在第二页 + 缩放（适应宽度）
// 观察：1) 点击表格是否进格 2) 页面是否滚动跳走 3) 分页装饰层遮挡
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 150)))
p.setDefaultTimeout(30000)
await p.goto(BASE + '/?r=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
// 打开真实合同文档（多页 + 多表格）
const buf = fs.readFileSync(DOC)
const form = new FormData()
form.append('file', new Blob([buf]), 'contract.docx')
const r = await fetch(BASE + '/api/doc/open', { method: 'POST', body: form })
const j = await r.json()
await p.evaluate(d => window.__setDocForTest(d), j.document)
await p.waitForTimeout(5000)
// 文档概况
const info = await p.evaluate(() => ({
  tables: document.querySelectorAll('.ProseMirror table').length,
  pages: document.querySelectorAll('.pm-page').length,
  wrappers: document.querySelectorAll('.tableWrapper').length,
  scrollH: document.querySelector('.overflow-auto')?.scrollHeight,
}))
console.log('文档概况:', JSON.stringify(info))
// 找到第二页的表格（跨页场景）
const tbl = await p.evaluate(() => {
  const tables = [...document.querySelectorAll('.ProseMirror table')]
  const t = tables[2] || tables[0]
  if (!t) return null
  t.scrollIntoView({ block: 'center' })
  return true
})
await p.waitForTimeout(1500)
// 点击前记录滚动位置
const before = await p.evaluate(() => ({ top: document.querySelector('.overflow-auto').scrollTop, sel: window.__pmView.state.selection.from }))
// 点击表格格
const box = await p.evaluate(() => { const tds = [...document.querySelectorAll('td')]; const td = tds[6] || tds[0]; const r = td.getBoundingClientRect(); return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.5, vis: r.y > 60 && r.y < 860 } })
console.log('目标格:', JSON.stringify(box))
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(900)
const after = await p.evaluate(() => ({
  top: document.querySelector('.overflow-auto').scrollTop,
  sel: window.__pmView.state.selection.from,
  docSize: window.__pmView.state.doc.content.size,
  focus: window.__pmView.hasFocus(),
  anchor: window.getSelection()?.anchorNode?.nodeName,
}))
console.log('点击前:', JSON.stringify(before))
console.log('点击后:', JSON.stringify(after))
console.log('滚动跳变:', after.top - before.top, 'px', Math.abs(after.top - before.top) > 50 ? '⚠️ 页面跳走!' : '✓ 稳定')
console.log('光标进格?', (after.sel < after.docSize && after.sel !== before.sel) ? 'sel=' + after.sel : '❌ 未变化')
await b.close()
