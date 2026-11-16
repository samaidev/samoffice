// 复现打印预览表格问题：打开对话框 → 截图预览区 + 提取预览 DOM 里
// 表格的实际样式（对比编辑器）：
// 编辑器实际：表格宽度/对齐/居中 —— 打印预览应一致
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
const buf = fs.readFileSync(DOC)
const form = new FormData()
form.append('file', new Blob([buf]), 'contract.docx')
const r = await fetch(BASE + '/api/doc/open', { method: 'POST', body: form })
const j = await r.json()
await p.evaluate(d => window.__setDocForTest(d), j.document)
await p.waitForTimeout(5000)
// 编辑器里表格的实际样式
const editorTbl = await p.evaluate(() => {
  const t = document.querySelector('.ProseMirror table')
  const w = t.closest('.tableWrapper')
  const r = t.getBoundingClientRect()
  const wr = w.getBoundingClientRect()
  const pm = document.querySelector('.ProseMirror')
  const pmr = pm.getBoundingClientRect()
  const cs = getComputedStyle(w)
  return {
    tableW: Math.round(r.width), wrapperW: Math.round(wr.width),
    wrapperML: cs.marginLeft, wrapperMR: cs.marginRight,
    wrapperLeft: Math.round(wr.left - pmr.left), pmW: Math.round(pmr.width),
    centered: Math.abs((wr.left - pmr.left) - (pmr.right - wr.right)) < 10,
    wrapperStyleAttr: w.getAttribute('style'),
  }
})
console.log('编辑器表格:', JSON.stringify(editorTbl, null, 1))
// 打开打印预览
// 切到 View 标签（打印按钮在 view tab，DocumentEditor.tsx:3822）
const tabName = await p.evaluate(() => {
  const tabs = [...document.querySelectorAll('button')]
  const v = tabs.find(t => t.textContent?.trim() === 'View')
  if (v) { v.click(); return 'View' }
  return null
})
console.log('切换标签:', tabName)
await p.waitForTimeout(600)
const pr = await p.evaluate(() => {
  const btn = document.querySelector('[data-testid=word-print-btn]')
  if (btn) { btn.click(); return 'clicked' }
  return null
})
console.log('打印按钮:', pr)
await p.waitForTimeout(1000)
// 若 Ctrl+P 被浏览器拦截，点工具栏打印按钮
const dlgVisible = await p.evaluate(() => !!document.querySelector('[class*=modal-overlay], .print-preview, [data-testid*=print]'))
console.log('Ctrl+P 打开对话框:', dlgVisible)
if (!dlgVisible) {
  // 找打印按钮（文件菜单或工具栏）
  const btn = await p.evaluate(() => {
    const btns = [...document.querySelectorAll('button')]
    const pr = btns.find(b => b.textContent?.includes('打印') || b.title?.includes('打印'))
    if (pr) { pr.click(); return pr.textContent?.slice(0, 10) }
    return null
  })
  console.log('点了打印按钮:', btn)
  await p.waitForTimeout(800)
}
await p.waitForTimeout(1500)
// 预览区表格样式
const pvTbl = await p.evaluate(() => {
  // 打印对话框本体（.modal-overlay/.modal 或 PrintDialog 渲染的容器）
  const allTables = [...document.querySelectorAll('table')]
  // 编辑器里的表格数
  const editorTables = [...document.querySelectorAll('.ProseMirror table')].length
  if (allTables.length <= editorTables) return { found: false, editorTables, all: allTables.length }
  // 预览表格 = 编辑器外的
  const pvTables = allTables.filter(t => !t.closest('.ProseMirror'))
  const t = pvTables[0]
  const w = t.closest('.tableWrapper')
  const r = t.getBoundingClientRect()
  const cs = w ? getComputedStyle(w) : null
  // 预览容器（缩放层）
  const scaleEl = t.closest('[style*=transform], [style*=scale]')
  const paper = t.closest('[style*=width]') 
  return {
    found: true, pvCount: pvTables.length,
    tableW: Math.round(r.width),
    wrapperML: cs?.marginLeft, wrapperMR: cs?.marginRight,
    wrapperStyle: w?.getAttribute('style'),
    wrapperCls: w?.className?.toString().slice(0, 30),
    scale: scaleEl ? scaleEl.getAttribute('style')?.slice(0, 60) : null,
    tableLeft: Math.round(r.left), tableTop: Math.round(r.top),
  }
})
console.log('预览表格:', JSON.stringify(pvTbl, null, 1))
// 截图预览
await p.screenshot({ path: '/tmp/print_preview.png', fullPage: false })
console.log('截图: /tmp/print_preview.png')
await b.close()
