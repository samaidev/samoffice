// PM 表格移到 body 后可点击！→ 表格 DOM 本身无罪，是它在【编辑器内部】时
// 被某层"吃"了。逐层把表格 wrapper 在编辑器内部上移：
// pm-host → pageRef → 缩放层 → editorScroll。每次只上一层，看何时恢复点击。
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
await p.waitForTimeout(1000)

const steps = await p.evaluate(() => {
  const td = [...document.querySelectorAll('.ProseMirror td')][2]
  const wrapper = td.closest('.tableWrapper')
  let el = wrapper.parentElement
  const chain = []
  while (el && el !== document.body) { chain.push(el); el = el.parentElement }
  return chain.map((e, i) => i + ':' + e.tagName + '.' + (e.className || '').toString().trim().slice(0, 22))
})
console.log('chain:', JSON.stringify(steps))

// 表格 wrapper 的原位置信息
await p.evaluate(() => {
  const td = [...document.querySelectorAll('.ProseMirror td')][2]
  const wrapper = td.closest('.tableWrapper')
  window.__w = wrapper
  window.__home = wrapper.parentElement
  window.__next = wrapper.nextSibling
  // fixed 化避免布局跳动
  const r = wrapper.getBoundingClientRect()
  wrapper.style.cssText += `;position:fixed;left:${r.x}px;top:${r.y}px;margin:0;z-index:99999;background:#e0f2fe`
})
// 层级列表（表格直接父级从 0=ProseMirror 开始往上）
// 依次把 wrapper append 到 chain[i]（即 wrapper 的第 i 级祖先），点击
const results = []
for (let i = 1; i < steps.length; i++) {
  const ok = await p.evaluate((i) => {
    const w = window.__w
    const chain = []
    let el = window.__home
    while (el && el !== document.body) { chain.push(el); el = el.parentElement }
    const target = chain[i - 1] // wrapper 移入 chain[i-1]（chain[0]=原父=ProseMirror）
    if (!target) return null
    target.appendChild(w)
    const r = w.getBoundingClientRect()
    return { host: (target.className || target.tagName).toString().trim().slice(0, 25), x: r.x + r.width / 2, y: r.y + r.height / 2, vis: r.y > 0 && r.y < 850 && r.height > 10 }
  }, i)
  if (!ok) continue
  await p.waitForTimeout(250)
  if (!ok.vis) { results.push(`${i}: ${ok.host} → out of view`); continue }
  await p.evaluate(() => { window.__evN = []; window.addEventListener('pointerdown', e => window.__evN.push(e.target.tagName), true) })
  await p.mouse.click(ok.x, ok.y)
  await p.waitForTimeout(180)
  const ev = await p.evaluate(() => window.__evN)
  results.push(`${i}: host=${ok.host} → ${ev.length ? 'OK(' + ev[0] + ')' : 'DEAD'}`)
  if (ev.length) break // 找到恢复点即停
}
console.log(results.join('\n'))
await b.close()
