import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const b = await chromium.launch({ args: ['--no-sandbox'], headless: false })
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
const info = await p.evaluate(() => {
  const pm = window.__pmView
  const pmR = pm.dom.getBoundingClientRect()
  // PM 的 offsetParent / 包含块
  const sc = pm.dom.closest('.overflow-auto, .overflow-y-auto') || pm.dom.closest('[class*="overflow"]')
  const scR = sc?.getBoundingClientRect()
  return {
    pm: { y: Math.round(pmR.y), h: Math.round(pmR.height), w: Math.round(pmR.width), x: Math.round(pmR.x) },
    sc: sc ? { cls: String(sc.className).slice(0, 30), y: Math.round(scR.y), h: Math.round(scR.height), st: sc.scrollTop } : null,
    docHeight: pm.state.doc.content.size,
  }
})
console.log('初始:', JSON.stringify(info))
await p.evaluate(() => { const sc = window.__pmView.dom.closest('[class*="overflow"]'); sc.scrollTo({ top: 10230 }) })
await p.waitForTimeout(2000)
const after = await p.evaluate(() => {
  const pm = window.__pmView
  const pmR = pm.dom.getBoundingClientRect()
  const sc = pm.dom.closest('[class*="overflow"]')
  const scR = sc.getBoundingClientRect()
  // y=158 的段落
  let pEl = null
  for (const el of document.querySelectorAll('.ProseMirror p')) {
    const r = el.getBoundingClientRect()
    if (el.textContent.includes('参数模拟') && r.y > 100 && r.y < 400) { pEl = el; break }
  }
  const pr = pEl?.getBoundingClientRect()
  return {
    pmY: Math.round(pmR.y), scY: Math.round(scR.y), scH: Math.round(scR.height), st: sc.scrollTop,
    paraY: pr ? Math.round(pr.y) : null,
    paraInSc: pEl ? sc.contains(pEl) : null,
    // 视觉裁剪检验：段落 y < scY 但能被 elementFromPoint 命中吗
    hitAbove: pEl ? (() => { const h = document.elementFromPoint(pr.x + 40, pr.y + 10); return h === pEl || pEl.contains(h) })() : null,
  }
})
console.log('滚动后:', JSON.stringify(after))
await b.close()
