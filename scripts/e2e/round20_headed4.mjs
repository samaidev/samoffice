// headed 下 headed2 的 y=541 点击事件能到（mousedown ✓），headed3 的 mouse.click 却不生效。
// 区别：headed2 是多次连续点击（400,480,541 顺序点击）—— 热身？还是
// mouse.click 内部的 move 路径问题？headed3 的 box 中心可能在不同位置。
// 逐步：点击前后检查命中元素 + focus/blur 事件序列
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const b = await chromium.launch({ args: ['--no-sandbox'], headless: false })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(15000)
const cmsgs = []
p.on('console', m => cmsgs.push(m.text().slice(0, 90)))
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
  const sc = document.querySelector('.flex-1.overflow-auto')
  const td = document.querySelector('.ProseMirror table td')
  const scRect = sc.getBoundingClientRect()
  const tdTop = td.getBoundingClientRect().top
  sc.scrollTop += tdTop - scRect.top - 300
})
await p.waitForTimeout(2500)
await p.evaluate(() => {
  for (const t of ['mousedown', 'focus', 'blur', 'click']) {
    window.addEventListener(t, e => console.log(`E:${t}:${e.target.tagName}${e.target.className?.toString().slice(0, 12) || ''}`), true)
  }
})
const box = await p.evaluate(() => {
  const td = document.querySelector('.ProseMirror table td')
  const r = td.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, top: Math.round(r.top) }
})
console.log('目标:', JSON.stringify(box))
// 分步：move → down → up
await p.mouse.move(box.x, box.y)
await p.waitForTimeout(300)
const hitNow = await p.evaluate(({x, y}) => {
  const el = document.elementFromPoint(x, y)
  return el ? el.tagName + ' inTD=' + !!el.closest('td') + ' tdTop=' + Math.round(el.closest('td')?.getBoundingClientRect().top || -1) : 'null'
}, box)
console.log('move后命中:', hitNow)
await p.mouse.down()
await p.waitForTimeout(150)
await p.mouse.up()
await p.waitForTimeout(400)
console.log('事件流:', cmsgs.filter(m => m.startsWith('E:')).slice(0, 8).join(' | ') || '(无)')
await b.close()
