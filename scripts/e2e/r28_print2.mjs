// 用 setPrintDialogOpen 的 React 状态不好碰 —— 找 Ribbon 标签结构：
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
const tabs = await p.evaluate(() => {
  // 所有可点的 tab 样式元素
  const els = [...document.querySelectorAll('button, [role=tab], [class*=tab-item], [class*=Tab]')]
  return els.filter(e => e.offsetParent !== null).map(e => ({ tag: e.tagName, txt: (e.textContent || '').slice(0, 8), cls: (e.className || '').toString().slice(0, 30) })).slice(0, 20)
})
console.log('可点元素:', JSON.stringify(tabs, null, 1))
await b.close()
