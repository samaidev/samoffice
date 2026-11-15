import { chromium } from 'playwright'
import fs from 'fs'

const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const b = await chromium.launch({ args: ['--no-sandbox'] })
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

// tdCount=36 但探针 y=9957（表格在文档深处）—— tdCount 36 是全文档表格总和。
// GONE 但 MutationObserver 0 变化 —— 矛盾的唯一解释：**探针 td 被移出视口时
// 分页引擎把表格渲染成多份**（每页一份）或 [data-probe] 的 td 被 PM 重新渲染
// （descendants 更新 style 覆盖 attributes）。
// 检验：GONE 时该位置现在是什么元素？之前 .ProseMirror 有 1 个 table 吗？
await p.evaluate(() => {
  document.querySelector('.ProseMirror table td').setAttribute('data-probe', '1')
  document.querySelector('[data-probe]').scrollIntoView({ block: 'center' })
})
await p.waitForTimeout(600)
const after = await p.evaluate(() => {
  const tables = document.querySelectorAll('.ProseMirror table')
  const td0 = document.querySelector('.ProseMirror table td')
  // td0 与 data-probe 所在表格是否同一个
  const probeGone = !document.querySelector('[data-probe]')
  // 第一个 td 的当前内容
  return {
    tables: tables.length,
    probeGone,
    firstTdText: td0?.textContent?.slice(0, 8),
    firstTdHasProbe: td0?.hasAttribute('data-probe'),
    // 全文档含 probe 的元素
    probeAnywhere: !!document.querySelector('[data-probe]'),
  }
})
console.log('滚动后:', JSON.stringify(after))
await b.close()
