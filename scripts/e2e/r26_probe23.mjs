// ★★★★ 决定性证据！
// - 点击表格上方 15px（y=499，仍是段落）→ 事件正常 (P)
// - 点击表格后插入的 PROBE（视觉 y=1041 附近）→ HTML（落空）
// → 落空区从表格顶部开始一直延伸！表格后的内容全死。但段落 y=499 活着。
// 这是「表格 wrapper 高度 vs 实际渲染内容高度不匹配」：合成器认为该区域
// 属于表格（表格的合成层），但表格层的绘制内容没覆盖到那里 / 或有巨大
// 的透明区域。本质：**wrapper 的 scrollHeight 远大于其内容** —— 检查
// wrapper 与 table 的尺寸关系 + 是否 table 内有 row 被推到极远处（pg-brk-row translateY）
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
const geo = await p.evaluate(() => {
  const td = [...document.querySelectorAll('.ProseMirror td')][2]
  const wrapper = td.closest('.tableWrapper')
  const table = td.closest('table')
  const rows = [...table.rows]
  const lastRow = rows[rows.length - 1].getBoundingClientRect()
  const wr = wrapper.getBoundingClientRect()
  return {
    wrapper: { top: Math.round(wr.top), bottom: Math.round(wr.bottom), h: Math.round(wr.height) },
    table: { top: Math.round(table.getBoundingClientRect().top), bottom: Math.round(table.getBoundingClientRect().bottom), h: Math.round(table.getBoundingClientRect().height) },
    lastRow: { top: Math.round(lastRow.top), bottom: Math.round(lastRow.bottom) },
    // td 的 rect vs 它的行
    tdY: Math.round(td.getBoundingClientRect().top),
    // PM dom 的 scrollHeight vs 内容
    pmScrollH: window.__pmView.dom.scrollHeight,
    pmRectBottom: Math.round(window.__pmView.dom.getBoundingClientRect().bottom),
  }
})
console.log(JSON.stringify(geo, null, 1))
await b.close()
