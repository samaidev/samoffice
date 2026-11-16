// 阅读发现：round22 已修过同类问题（translateY）。但 TD 在 y=516 处的行是
// 「未断行的行」（表格上半段）—— 它不该有 translateY。
// 看当前 DOM 里 tr 的实际 transform 状态 + 表格上部是否在"页尾"（跨页点）
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(800)
const buf = fs.readFileSync(DOC)
const form = new FormData()
form.append('file', new Blob([buf]), 'contract.docx')
const r = await fetch(BASE + '/api/doc/open', { method: 'POST', body: form })
const j = await r.json()
await p.evaluate(d => window.__setDocForTest(d), j.document)
await p.waitForTimeout(3500)
await p.evaluate(() => { [...document.querySelectorAll('.ProseMirror td')][2].scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(1200)
const info = await p.evaluate(() => {
  const table = [...document.querySelectorAll('.ProseMirror table')][0]
  const wrapper = table.closest('.tableWrapper')
  const ws = getComputedStyle(wrapper)
  const ts = getComputedStyle(table)
  const rows = [...table.rows].map((tr, i) => {
    const s = getComputedStyle(tr)
    const r = tr.getBoundingClientRect()
    return { i, y: Math.round(r.y), h: Math.round(r.height), cls: (tr.className || '').toString().slice(0, 20), transform: s.transform.slice(0, 30), mt: s.marginTop }
  })
  // 点击点相对"纸张内容区"位置：页高多少
  const papers = [...document.querySelectorAll('.pg-paper')].slice(0, 3).map(pp => { const r = pp.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom) } })
  return {
    wrapperMB: ws.marginBottom, wrapperCls: (wrapper.className || '').toString(),
    tableTransform: ts.transform, tableMB: ts.marginBottom,
    rows: rows.slice(0, 8),
    papers,
  }
})
console.log(JSON.stringify(info, null, 1))
await b.close()
