// 滚动后点击：滚动到不同深度点击正文段落 + 表格
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
for (const scrollY of [600, 1500, 3000, 5000]) {
  await p.evaluate(y => { document.querySelector('.flex-1.overflow-auto')?.scrollTo({ top: y }); window.scrollTo(0, y) }, scrollY)
  await p.waitForTimeout(700)
  // 点击视口中部正文（先找当前视口内的段落）
  const res = await p.evaluate(() => {
    const pm = window.__pmView
    let target = null
    pm.state.doc.descendants((n, pos) => {
      if (target) return false
      if (n.type.name === 'paragraph' && n.textContent.trim().length > 6) {
        const el = pm.nodeDOM(pos)
        if (el) {
          const r = el.getBoundingClientRect()
          if (r.y > 200 && r.y < 700 && r.height > 5) target = { x: r.x + 80, y: r.y + r.height / 2, text: n.textContent.slice(0, 10) }
        }
      }
      return !target
    })
    return target
  })
  if (!res) { console.log('scroll=' + scrollY + ': 视口内无段落'); continue }
  await p.mouse.click(res.x, res.y)
  await p.waitForTimeout(400)
  const focused = await p.evaluate(() => window.__pmView.hasFocus())
  const len1 = await p.evaluate(() => window.__pmView.state.doc.textContent.length)
  await p.keyboard.type('K', { delay: 30 })
  await p.waitForTimeout(300)
  const len2 = await p.evaluate(() => window.__pmView.state.doc.textContent.length)
  console.log(`scroll=${scrollY} 点[${res.text}] focus=${focused} 输入=${len2 > len1 ? 'OK' : 'FAIL'} (${len1}→${len2})`)
  // 撤销输入
  await p.keyboard.press('Control+z')
  await p.waitForTimeout(200)
}
await b.close()
