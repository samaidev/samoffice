// focus/blur 事件序列监听 —— 点击瞬间谁抢了焦点
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
await p.evaluate(() => { const sc = document.querySelector('.flex-1.overflow-auto'); sc.scrollTo({ top: 10230 }) })
await p.waitForTimeout(2000)
// 全局 focus/blur/mousedown 日志
await p.evaluate(() => {
  window.__flog = []
  const tag = el => el ? el.tagName + '.' + String(el.className).slice(0, 25) : 'null'
  for (const t of ['mousedown', 'focusin', 'focusout', 'blur', 'click']) {
    document.addEventListener(t, (e) => {
      window.__flog.push(t + '@' + tag(e.target) + ' → active=' + tag(document.activeElement))
    }, t === 'blur' || t === 'focus' ? true : false)
  }
})
const pt = await p.evaluate(() => {
  for (const el of document.querySelectorAll('.ProseMirror p')) {
    const r = el.getBoundingClientRect()
    if (r.y > 150 && r.y < 400 && el.textContent.trim().length > 5) return { x: r.x + 80, y: r.y + r.height / 2 }
  }
})
await p.mouse.click(pt.x, pt.y)
await p.waitForTimeout(600)
const log = await p.evaluate(() => window.__flog.slice())
console.log('点击事件序列:')
log.forEach(l => console.log('  ', l))
const fin = await p.evaluate(() => ({
  focus: window.__pmView.hasFocus(),
  active: document.activeElement ? document.activeElement.tagName + '.' + String(document.activeElement.className).slice(0, 30) : 'null',
}))
console.log('最终:', JSON.stringify(fin))
await b.close()
