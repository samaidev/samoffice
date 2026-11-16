// 简化 verify9：不用 Function 传参，直接逐个变体硬编码
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const BASE = 'http://localhost:18400'
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
await p.evaluate(() => { [...document.querySelectorAll('.ProseMirror td')][2].scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(1000)
const setupAndClick = async (variant) => {
  const box = await p.evaluate((v) => {
    const pm = window.__pmView.dom
    const td = [...document.querySelectorAll('.ProseMirror td')][2]
    const wrapper = td.closest('.tableWrapper')
    document.querySelectorAll('[data-tprobe]').forEach(e => e.remove())
    const t = document.createElement('table')
    t.setAttribute('data-tprobe', '1')
    t.style.cssText = 'border:2px solid #d33;width:300px;height:70px;background:#fffde7;position:relative;z-index:9'
    t.innerHTML = '<tr><td>V</td></tr>'
    wrapper.parentElement.insertBefore(t, wrapper)
    if (v === 'ce-false') pm.setAttribute('contenteditable', 'false')
    if (v === 'no-class') pm.className = ''
    if (v === 'restore') { pm.setAttribute('contenteditable', 'true'); pm.className = 'ProseMirror' }
    window.__e = []
    window.addEventListener('pointerdown', e => window.__e.push(e.target.tagName), { capture: true, passive: true })
    const r = t.getBoundingClientRect()
    return { x: r.x + 40, y: r.y + 35 }
  }, variant)
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(150)
  return (await p.evaluate(() => window.__e.length)) > 0
}
console.log('baseline:', await setupAndClick('restore') ? 'ALIVE' : 'DEAD')
console.log('ce-false:', await setupAndClick('ce-false') ? 'ALIVE' : 'DEAD')
console.log('no-class:', await setupAndClick('no-class') ? 'ALIVE' : 'DEAD')
await b.close()
