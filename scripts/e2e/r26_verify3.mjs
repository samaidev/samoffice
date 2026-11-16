// transform 已全消但依然点不到！probe44 的 L2(position:relative; z-index:1)
// 与 L1(flex) 也 DEAD，L4(pageRef) ALIVE —— 死层不止 transform 一个。
// 重新跑层阶梯（现在无 transform 了，看死层是否变化）：
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1000)
const buf = fs.readFileSync(DOC)
const form = new FormData()
form.append('file', new Blob([buf]), 'contract.docx')
const r = await fetch(BASE + '/api/doc/open', { method: 'POST', body: form })
const j = await r.json()
await p.evaluate(d => window.__setDocForTest(d), j.document)
await p.waitForTimeout(4000)
await p.evaluate(() => { [...document.querySelectorAll('.ProseMirror td')][2].scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(1000)
const layers = await p.evaluate(() => {
  const pm = window.__pmView.dom
  const pageRef = pm.closest('.mx-auto')
  const arr = []
  let el = pm.parentElement
  while (el && el !== pageRef) { arr.push(el); el = el.parentElement }
  arr.push(pageRef)
  return arr.map((e, i) => i + ':' + (e.getAttribute('style') || '').slice(0, 70) + ' ||| cls=' + (e.className || '').toString().slice(0, 20))
})
console.log(layers.join('\n'))
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
