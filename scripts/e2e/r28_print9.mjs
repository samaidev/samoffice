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
await p.evaluate(() => { const v = [...document.querySelectorAll('button')].find(t => t.textContent?.trim() === 'View'); v?.click() })
await p.waitForTimeout(600)
await p.evaluate(() => { document.querySelector('[data-testid=word-print-btn]')?.click() })
await p.waitForTimeout(2000)
const pv = await p.evaluate(() => {
  const host = document.querySelector('.pm-nocaret')
  const t = host.querySelector('table')
  const td = t.querySelector('td')
  const cs = getComputedStyle(td)
  // 纸面（scale 层的父容器）与内容比例
  const paper = host.parentElement
  return {
    tdBorder: cs.borderTopWidth + ' ' + cs.borderTopColor + ' ' + cs.borderTopStyle,
    tdPadding: cs.padding,
    tableW: Math.round(t.getBoundingClientRect().width),
    hostW: Math.round(host.getBoundingClientRect().width),
    paperW: Math.round(paper.getBoundingClientRect().width),
    tableVsHost: Math.round(t.getBoundingClientRect().width) + '/' + Math.round(host.getBoundingClientRect().width),
    fontFamily: cs.fontFamily.slice(0, 30),
    fontSize: cs.fontSize,
  }
})
console.log('预览表格细节:', JSON.stringify(pv, null, 1))
await b.close()
