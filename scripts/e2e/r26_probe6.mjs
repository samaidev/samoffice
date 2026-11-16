// 克隆到 body 后事件正常（target=P）→ 表格本身无辜，问题在祖先层。
// 逐层上移：把原表格依次挂到不同祖先级别的兄弟位置，找出事件失效的第一层。
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(800)
const buf = fs.readFileSync(DOC)
const form = new FormData()
form.append('file', new Blob([buf]), 'contract.docx')
const r = await fetch(BASE + '/api/doc/open', { method: 'POST', body: form })
const j = await r.json()
await p.evaluate(d => window.__setDocForTest(d), j.document)
await p.waitForTimeout(3500)
await p.evaluate(() => { [...document.querySelectorAll('.ProseMirror td')][2].scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(1200)

// 建立祖先链：TD → TABLE → tableWrapper → .ProseMirror → pm-host → 缩放层 → pageRef → ...
const chain = await p.evaluate(() => {
  const td = [...document.querySelectorAll('.ProseMirror td')][2]
  const arr = []
  let el = td.closest('table')
  while (el && el !== document.body) {
    arr.push({ tag: el.tagName, cls: (el.className || '').toString().trim().slice(0, 28), el })
    el = el.parentElement
  }
  // 序列化（不含 el 引用）
  return arr.map(a => a.tag + '.' + a.cls)
})
console.log('ancestors:', JSON.stringify(chain))

// 依次：把【原表格】从当前位置临时 reparent 到每个祖先的 parent，点击，记录事件
for (let i = 0; i < chain.length; i++) {
  const res = await p.evaluate((i) => {
    const td = [...document.querySelectorAll('.ProseMirror td')][2]
    const table = td.closest('table')
    const wrapper = table.closest('.tableWrapper') || table
    // 找第 i 个祖先
    let el = table.parentElement
    const arr = []
    while (el && el !== document.body) { arr.push(el); el = el.parentElement }
    const target = arr[i]
    if (!target) return null
    const home = wrapper.parentElement
    const next = wrapper.nextSibling
    // reparent: 放到 target 的 parent 的末尾
    target.parentElement.appendChild(wrapper)
    const r = table.getBoundingClientRect()
    window.__cur = { wrapper, home, next }
    return { host: (target.className || target.tagName).toString().slice(0, 25), rect: { x: r.x + r.width / 2, y: r.y + r.height / 2, vis: r.y > 0 && r.y < innerHeight } }
  }, i)
  if (!res) continue
  await p.waitForTimeout(300)
  await p.evaluate(() => { window.__tN = []; window.addEventListener('pointerdown', e => window.__tN.push(e.target.tagName), true) })
  if (res.rect.vis) {
    await p.mouse.click(res.rect.x, res.rect.y)
    await p.waitForTimeout(200)
    const ev = await p.evaluate(() => window.__tN)
    console.log(`reparent to [${i}] ${res.host} → events:`, JSON.stringify(ev))
  } else {
    console.log(`reparent to [${i}] ${res.host} → out of view, skip`)
  }
  // 还原
  await p.evaluate(() => {
    const { wrapper, home, next } = window.__cur
    if (next && next.parentElement === home) home.insertBefore(wrapper, next)
    else home.appendChild(wrapper)
  })
  await p.waitForTimeout(200)
}
await b.close()
