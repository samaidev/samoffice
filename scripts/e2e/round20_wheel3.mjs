// 无 contain/cv。换终极武器：滚动后强制【重排 hit-test 层】——
// 改一下 scroller 的样式（读 offsetHeight 触发 layout）再点击，看是否恢复：
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const b = await chromium.launch({ args: ['--no-sandbox'], headless: false })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(20000)
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
await p.waitForTimeout(2500)
await p.evaluate(() => {
  window.__hit = -1
  window.addEventListener('mousedown', () => { window.__hit = 1 }, true)
})
// 滚动到表格
await p.evaluate(() => {
  const sc = document.querySelector('.flex-1.overflow-auto')
  const td = document.querySelector('.ProseMirror table td')
  const scRect = sc.getBoundingClientRect()
  const tdTop = td.getBoundingClientRect().top
  sc.scrollTop += tdTop - scRect.top - 300
})
await p.waitForTimeout(2000)
const tryClick = async (label) => {
  await p.evaluate(() => { window.__hit = -1 })
  const box = await p.evaluate(() => {
    const td = document.querySelector('.ProseMirror table td')
    const r = td.getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  })
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(200)
  const hit = await p.evaluate(() => window.__hit)
  console.log(`${label}: ${hit >= 0 ? '✓' : '✗'}`)
  return hit >= 0
}
await tryClick('滚动后基线')
// 干预1：强制 window resize 事件（触发 compositor 重新布局）
await p.evaluate(() => { window.dispatchEvent(new Event('resize')) })
await p.waitForTimeout(400)
if (await tryClick('resize事件后')) console.log('>>> resize 修复')
// 干预2：切换 scroller overflow hidden→auto
await p.evaluate(() => {
  const sc = document.querySelector('.flex-1.overflow-auto')
  sc.style.overflow = 'hidden'
  void sc.offsetHeight
  sc.style.overflow = ''
})
await p.waitForTimeout(500)
if (await tryClick('overflow切换后')) console.log('>>> overflow 切换修复')
// 干预3：zoom 层重设
await p.evaluate(() => {
  const pm = document.querySelector('.ProseMirror')
  let n = pm
  while (n && n !== document.body) {
    if (getComputedStyle(n).transform !== 'none') {
      n.style.transform = 'scale(1.0000001)'
      setTimeout(() => { n.style.transform = '' }, 50)
      return
    }
    n = n.parentElement
  }
})
await p.waitForTimeout(500)
if (await tryClick('transform 抖动后')) console.log('>>> transform 抖动修复')
await b.close()
