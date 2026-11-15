import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const BASE = 'http://127.0.0.1:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1000)
const buf = fs.readFileSync(DOC)
const form = new FormData()
form.append('file', new Blob([buf]), 'contract.docx')
const r = await fetch(BASE + '/api/doc/open', { method: 'POST', body: form })
const j = await r.json()
await p.evaluate(d => window.__setDocForTest(d), j.document)
await p.waitForTimeout(4000)
// 探针：记录 math dom 上的事件流 + 点击后选区
await p.evaluate(() => {
  const el = document.querySelector('.sam-math')
  window.__ev = []
  ;['mousedown', 'mouseup', 'click'].forEach(t => el.addEventListener(t, e => window.__ev.push(t + ':defaultPrevented=' + e.defaultPrevented), { capture: false }))
  const root = document.querySelector('.ProseMirror')
  root.addEventListener('mousedown', () => window.__ev.push('root-mousedown'), true)
})
const el = p.locator('.sam-math').first()
await el.scrollIntoViewIfNeeded()
const box = await el.boundingBox()
await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
await p.waitForTimeout(500)
const st = await p.evaluate(() => ({
  ev: window.__ev,
  selType: window.__pmView?.state?.selection?.type?.name,
  cls: document.querySelector('.sam-math').className,
  viewHasNodeSel: window.__pmView?.state?.selection?.node?.type?.name || '',
}))
console.log(JSON.stringify(st, null, 1))
await b.close()
