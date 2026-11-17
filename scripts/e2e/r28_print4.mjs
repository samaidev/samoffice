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
// Ribbon 标签：DOM 树找（Word 编辑器顶部）
const tabs = await p.evaluate(() => {
  const word = document.querySelector('.ProseMirror')?.closest('[class*=editor]') || document.body
  // 找所有「短文本横向排列」的元素（标签栏特征）
  const cands = [...word.querySelectorAll('div,span,button,a')].filter(e => {
    const t = (e.textContent || '').trim()
    return t && t.length <= 10 && e.children.length === 0 && e.offsetParent !== null
  })
  // 找含 preview/review/view 的
  const hits = cands.filter(e => /preview|review|view|打印|预览/i.test(e.textContent)).map(e => ({ txt: e.textContent, tag: e.tagName, cls: (e.className || '').toString().slice(0, 40) }))
  return hits.slice(0, 8)
})
console.log('标签候选:', JSON.stringify(tabs, null, 1))
await b.close()
