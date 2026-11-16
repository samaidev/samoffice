// 读错了层！attr="position:relative; display:flex; flex:1 1 0%" —— 这不是
// scale 层（无 width:794px）。DOM 结构比想的深一层。
// 之前 probe42 的 'scaler' = pm-host.parentElement.parentElement 判死，
// 但 probe43 读它 attr 是 flex 容器。probe42 的层级判断有 off-by-one！
// 精确列出 pm-host 到 pageRef 的中间层并逐层测 fixed 表格。
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
const layers = await p.evaluate(() => {
  const pm = window.__pmView.dom
  const pageRef = pm.closest('.mx-auto')
  const arr = []
  let el = pm.parentElement
  while (el && el !== pageRef) { arr.push(el); el = el.parentElement }
  arr.push(pageRef)
  return arr.map((e, i) => i + ':' + e.tagName + ' style="' + (e.getAttribute('style') || '').slice(0, 80) + '" cls="' + (e.className || '').toString().slice(0, 24) + '"')
})
console.log(layers.join('\n'))
// 按层测（挂在每层内部）
const n = layers.length
const results = []
for (let i = 0; i < n; i++) {
  const box = await p.evaluate((i) => {
    document.querySelectorAll('[data-tprobe]').forEach(e => e.remove())
    const pm = window.__pmView.dom
    const pageRef = pm.closest('.mx-auto')
    const arr = []
    let el = pm.parentElement
    while (el && el !== pageRef) { arr.push(el); el = el.parentElement }
    arr.push(pageRef)
    const host = arr[i]
    const td = [...document.querySelectorAll('.ProseMirror td')][2]
    const r = td.getBoundingClientRect()
    const t = document.createElement('table')
    t.setAttribute('data-tprobe', '1')
    t.style.cssText = `position:fixed;left:${r.x}px;top:${r.y}px;width:${r.width}px;height:${r.height}px;z-index:2147483647;background:#fffde7`
    t.innerHTML = '<tr><td>P</td></tr>'
    host.appendChild(t)
    window.__e = []
    window.addEventListener('pointerdown', e => window.__e.push(e.target.tagName), { capture: true, passive: true })
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  }, i)
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(150)
  const ev = await p.evaluate(() => window.__e)
  results.push(`L${i} ${ev.length ? 'ALIVE' : 'DEAD'}`)
}
console.log(results.join('\n'))
await b.close()
