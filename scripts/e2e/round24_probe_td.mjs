import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const BASE = 'http://127.0.0.1:18400'
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
await p.waitForTimeout(4000)
const tdEl = p.locator('.ProseMirror td').first()
await tdEl.scrollIntoViewIfNeeded()
const cb = await tdEl.boundingBox()
const cx = cb.x + Math.min(80, cb.width / 2), cy = cb.y + cb.height / 2
const hitInfo = await p.evaluate(([x, y]) => {
  const el = document.elementFromPoint(x, y)
  return { tag: el?.tagName, cls: (el?.className || '').toString().slice(0, 60), inEditor: !!el?.closest('.ProseMirror') }
}, [cx, cy])
await p.mouse.click(cx, cy)
await p.waitForTimeout(400)
await p.keyboard.type('R24', { delay: 80 })
await p.waitForTimeout(900)
const st = await p.evaluate(() => ({
  selType: window.__pmView?.state?.selection?.type?.name,
  inTd: !!window.__pmView?.state?.selection?.$from?.node()?.toString?.()?.match(/table|cell|row/i) || (window.__pmView?.state?.selection?.$from?.node(2)?.type?.name || ''),
  active: document.activeElement?.className?.toString().slice(0, 50),
  typed: [...document.querySelectorAll('.ProseMirror td')].some(td => td.textContent.includes('R24')),
}))
console.log('hit:', JSON.stringify(hitInfo))
console.log('after:', JSON.stringify(st))
await b.close()
