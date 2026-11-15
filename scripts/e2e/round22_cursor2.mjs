import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(25000)
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
await p.waitForTimeout(3500)
// 记录所有 transaction
await p.evaluate(() => {
  window.__txns = []
  const pm = window.__pmView
  const origDispatch = pm.dispatch.bind(pm)
  pm.dispatch = (tr) => {
    window.__txns.push({
      steps: tr.steps.length,
      types: tr.steps.map(s => s.constructor.name),
      mapped: tr.mapping.maps.length,
      sel: tr.selectionSet,
      docChanged: tr.docChanged,
      meta: Object.keys(tr.meta).slice(0, 4),
    })
    return origDispatch(tr)
  }
})
const clickPoints = await p.evaluate(() => {
  const pm = window.__pmView
  let target = null
  pm.state.doc.descendants((n, pos) => {
    if (target) return false
    if (n.type.name === 'paragraph' && n.textContent.trim().length > 3) {
      try {
        const el = pm.nodeDOM(pos)
        if (el) { const r = el.getBoundingClientRect(); if (r.height > 5) target = { x: r.x + 40, y: r.y + r.height / 2 } }
      } catch {}
    }
    return !target
  })
  return target
})
// 清空记录
await p.evaluate(() => { window.__txns = [] })
await p.mouse.click(clickPoints.x, clickPoints.y)
await p.waitForTimeout(500)
const clickTx = await p.evaluate(() => window.__txns.slice())
console.log('点击产生的 tx:', JSON.stringify(clickTx))
const lenBefore = await p.evaluate(() => window.__pmView.state.doc.textContent.length)
await p.evaluate(() => { window.__txns = [] })
await p.keyboard.type('AB', { delay: 50 })
await p.waitForTimeout(500)
const typeTx = await p.evaluate(() => window.__txns.slice())
const lenAfter = await p.evaluate(() => window.__pmView.state.doc.textContent.length)
console.log('输入 AB 的 tx:', JSON.stringify(typeTx))
console.log('文本长度:', lenBefore, '→', lenAfter)
// 输入的字符去哪了
const around = await p.evaluate(() => {
  const pm = window.__pmView
  const sel = pm.state.selection
  const $p = pm.state.doc.resolve(sel.from)
  const para = $p.parent
  return { selFrom: sel.from, paraText: para.textContent.slice(0, 40), offset: $p.parentOffset }
})
console.log('输入后光标上下文:', JSON.stringify(around))
await b.close()
