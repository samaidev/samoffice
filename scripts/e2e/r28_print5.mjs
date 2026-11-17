// ★ 复现关键数据：
// - 预览表格宽 124px（编辑器 554px）+ scale 0.30 —— 554*0.30≈167≠124
//   → 表格在预览里【更窄】（列宽丢失！）—— 
//   编辑器表格用 colwidth（autoFit 后固定列宽），克隆后预览丢了 col/colgroup
//   或 colwidth 的 inline 样式？wrapperStyle null 一致 —— 
// - tableLeft=835：预览纸宽多少？纸张左缘在哪？若纸宽内容区 < 表宽 → 
//   「没居中」其实也可能是「表格超出内容区」。
// 详细对比：预览 vs 编辑器的 table 内部结构（colgroup/col）与纸面几何：
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
await p.waitForTimeout(4000)
// 编辑器表格结构
const ed = await p.evaluate(() => {
  const t = document.querySelector('.ProseMirror table')
  const colgroup = t.querySelector('colgroup')
  const tableStyle = t.getAttribute('style')
  return {
    cols: colgroup ? [...colgroup.querySelectorAll('col')].map(c => c.getAttribute('style')) : null,
    tableStyle,
    tableCls: t.className,
    width: Math.round(t.getBoundingClientRect().width),
    layout: getComputedStyle(t).tableLayout,
  }
})
console.log('编辑器表格:', JSON.stringify(ed, null, 1))
await b.close()
