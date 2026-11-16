// found:false —— 预览里没有 table 了？也许 React 报错（渲染失败）或
// HMR 后对话框状态重置。看页面错误 + 预览容器内容：
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 200)))
p.on('console', m => { if (m.type() === 'error') console.log('CERR:', m.text().slice(0, 150)) })
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
await p.evaluate(() => { const v = [...document.querySelectorAll('button')].find(t => t.textContent?.trim() === 'View'); v?.click() })
await p.waitForTimeout(600)
await p.evaluate(() => { document.querySelector('[data-testid=word-print-btn]')?.click() })
await p.waitForTimeout(2000)
const st = await p.evaluate(() => {
  const dlgOpen = !!document.querySelector('.modal-overlay')
  const allTables = [...document.querySelectorAll('table')]
  const pvTables = allTables.filter(t => !t.closest('.ProseMirror') || t.closest('.pm-nocaret'))
  const nocaret = document.querySelector('.pm-nocaret')
  return {
    dlgOpen, allTables: allTables.length, pvTables: pvTables.length,
    nocaretExists: !!nocaret,
    nocaretChildCount: nocaret ? nocaret.children.length : -1,
    nocaretTag: nocaret?.tagName,
  }
})
console.log('预览状态:', JSON.stringify(st, null, 1))
await b.close()
