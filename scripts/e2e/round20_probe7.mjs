// CDP 都无效 —— 输入在浏览器合成层就被丢弃。elementFromPoint 却能命中 SPAN。
// 这强烈指向：SPAN 的某个祖先有 CSS touch-action/overscroll 或…
// 停！换一个根本性的验证：点击【视口空白】时事件能到（前面验证过 200,100 OK）。
// 点表格失败。也许问题不在"点击坐标"，而在 mouseMoved (315,325) 那一刻：
// probe5 中 move 后命中 SPAN —— 但【move 事件本身】到了吗？hover 时表格 resize 插件
// 会改 cursor。查 mousemove 到没到 + 是否 mouseMoved 之后元素位置漂移：
import { chromium } from 'playwright'
import fs from 'fs'

const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(15000)
const consoleMsgs = []
p.on('console', m => consoleMsgs.push(m.text()))
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
await p.evaluate(() => document.querySelector('.ProseMirror table').scrollIntoView({ block: 'center' }))
await p.waitForTimeout(3000)
await p.evaluate(() => {
  window.__evCount = {}
  for (const t of ['pointermove', 'mousemove', 'pointerdown']) {
    window.addEventListener(t, () => {
      window.__evCount[t] = (window.__evCount[t] || 0) + 1
    }, true)
  }
})
const box = await p.evaluate(() => {
  const td = document.querySelector('.ProseMirror table td')
  const r2 = td.getBoundingClientRect()
  return { x: Math.round(r2.x + r2.width / 2), y: Math.round(r2.y + r2.height / 2) }
})
// 1. 移到表格
await p.mouse.move(box.x, box.y)
await p.waitForTimeout(300)
const afterMove = await p.evaluate(() => window.__evCount)
// 2. 点击
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(300)
const afterClick = await p.evaluate(() => window.__evCount)
console.log('move后事件计数:', JSON.stringify(afterMove))
console.log('click后事件计数:', JSON.stringify(afterClick))
await b.close()
