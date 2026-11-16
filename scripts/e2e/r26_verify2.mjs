// HMR 已生效（模块里有 zoom !== 100）。上一轮测试失败可能是浏览器缓存 ——
// 新开 context + 强制 reload 重测
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
const scaler = await p.evaluate(() => {
  // 逐层找 transform scale 层
  const pm = window.__pmView.dom
  let el = pm.parentElement
  const chain = []
  while (el && el !== document.body) {
    const t = getComputedStyle(el).transform
    chain.push({ tag: el.tagName, cls: (el.className || '').toString().slice(0, 20), transform: t === 'none' ? '' : t })
    el = el.parentElement
  }
  return chain.filter(c => c.transform)
})
console.log('transforms remaining:', JSON.stringify(scaler))
const box = await p.evaluate(() => { const r = [...document.querySelectorAll('.ProseMirror td')][2].getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(350)
const st = await p.evaluate(() => {
  const v = window.__pmView
  return { sel: v.state.selection.type?.name, from: v.state.selection.from, focus: v.hasFocus() }
})
console.log('after click:', JSON.stringify(st))
await p.keyboard.type('Z9', { delay: 60 })
await p.waitForTimeout(400)
console.log('cell after typing:', JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('.ProseMirror td')][2]?.textContent)))
await b.close()
