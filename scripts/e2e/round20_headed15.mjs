// 表格稳定在 y=515，命中 SPAN(TD) —— down 时刻一切正常但事件消失。
// 终极隔离实验：【关掉所有插件扩展嫌疑】—— 用 page.addInitScript 在页面加载前
// 禁掉 PM 的 handleDOMEvents（测试构建不可改）……不可行。
// 
// ★ 突然意识到一个没验证的基本事实：段落点击成功案例里，
// 段落是不是【同一页】？表格在页面底部附近（页边界！）——
// 之前所有失败的点击都发生在【跨页表格】上！
// 跨页表格有 pg-brk-table 类 + pg-brk-row 行位移 + relative top！
// Chromium 的 input pipeline 对 position:relative 位移的表格行有
// hit-test 与事件目标的错位 bug —— elementFromPoint（JS hit-test）用
// 渲染后几何，而浏览器原生事件派发用【布局树几何】→ 相对位移的行
// 点击落在"原位"（表格原位置是页边界外/空白区）→ 无事件！
// 
// 验证：点击【不跨页的表格】（朱东山文档只有一张表？找表格是否 pg-brk-table）
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const b = await chromium.launch({ args: ['--no-sandbox'], headless: false })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(15000)
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
const info = await p.evaluate(() => {
  const tables = Array.from(document.querySelectorAll('.ProseMirror table'))
  return tables.map((t, i) => {
    const wrap = t.closest('.tableWrapper')
    const rows = Array.from(t.rows)
    const displaced = rows.filter(rw => getComputedStyle(rw).top !== 'auto').length
    const r = t.getBoundingClientRect()
    return { i, brk: wrap?.classList.contains('pg-brk-table'), rows: rows.length, displaced, y: Math.round(r.y), h: Math.round(r.height) }
  })
})
console.log('表格情况:', JSON.stringify(info, null, 1))
await b.close()
