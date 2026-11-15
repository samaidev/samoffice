// 滚动稳定后点击 + DOM 持续性检查
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
// 记录 PM 根节点引用
await p.evaluate(() => { window.__pmRoot = window.__pmView.dom; window.__pmHost = window.__pmRoot.parentElement })
// 平滑滚动 vs 瞬时滚动对照
for (const mode of ['instant', 'smooth']) {
  await p.evaluate(m => {
    const sc = document.querySelector('.flex-1.overflow-auto')
    sc.scrollTo({ top: 10230, behavior: m === 'smooth' ? 'smooth' : 'auto' })
  }, mode)
  // 等 5 秒（充分稳定 + 拼写/分页全部完成）
  await p.waitForTimeout(5000)
  const st = await p.evaluate(() => {
    const stillSame = window.__pmRoot === window.__pmView.dom
    const hostSame = window.__pmHost === window.__pmView.dom.parentElement
    return { stillSame, hostSame, childCount: window.__pmView.dom.childElementCount }
  })
  console.log(mode + ' 滚动+5s: PM根未变=' + st.stillSame + ' host未变=' + st.hostSame + ' 子元素数=' + st.childCount)
  const pt = await p.evaluate(() => {
    for (const el of document.querySelectorAll('.ProseMirror p')) {
      const r = el.getBoundingClientRect()
      if (r.y > 150 && r.y < 750 && el.textContent.trim().length > 5) return { x: r.x + 80, y: r.y + r.height / 2, text: el.textContent.slice(0, 8) }
    }
    return null
  })
  await p.mouse.click(pt.x, pt.y)
  await p.waitForTimeout(500)
  const f = await p.evaluate(() => window.__pmView.hasFocus())
  console.log(mode + ' 点击[' + pt.text + ']: focus=' + f, f ? 'OK' : 'FAIL')
}
await b.close()
