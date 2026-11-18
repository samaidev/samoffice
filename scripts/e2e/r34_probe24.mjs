import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
await p.goto(BASE + '/?r=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(2500)
await p.evaluate(async () => {
  const r = await fetch('/upload-test.docx')
  const buf = await r.arrayBuffer()
  const file = new File([buf], 'upload-test.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
  const dt = new DataTransfer()
  dt.items.add(file)
  document.querySelector('#root > div').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
})
await p.waitForTimeout(9000)
await p.evaluate(() => {
  window.__md = null
  document.addEventListener('mousedown', (e) => { window.__md = 'got@' + e.target.tagName + (e.target.id ? '#' + e.target.id : '') }, true)
})
await p.evaluate(() => { document.querySelector('table').scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(800)
// 在 chain[1]（width100% 层）放全新 table 和 div —— absolute 盖在死区上
const pos = await p.evaluate(() => {
  const wrap = document.querySelector('.tableWrapper')
  const chain = []
  let cur = wrap.parentElement
  while (cur && cur !== document.body) { chain.push(cur); cur = cur.parentElement }
  const host = chain[1]
  const r = wrap.getBoundingClientRect()
  const mk = (tag, id) => {
    const el = document.createElement(tag)
    el.id = id
    if (tag === 'table') el.innerHTML = '<tbody><tr><td>x</td></tr></tbody>'
    else el.textContent = 'x'
    Object.assign(el.style, { position: 'absolute', left: (r.x - host.getBoundingClientRect().x + 10) + 'px', top: (r.y - host.getBoundingClientRect().y + 10 + (tag === 'table' ? 40 : 100)) + 'px', width: '80px', height: '24px', background: '#f0f', zIndex: 4000 })
    host.appendChild(el)
  }
  mk('table', 'r34-fresh-tbl')
  mk('div', 'r34-fresh-div')
  return { hostCls: (typeof host.className === 'string' ? host.className : '') }
})
await p.waitForTimeout(400)
const spots = await p.evaluate(() => {
  const t = document.getElementById('r34-fresh-tbl').getBoundingClientRect()
  const d = document.getElementById('r34-fresh-div').getBoundingClientRect()
  return { tbl: { x: t.x + 20, y: t.y + 10 }, div: { x: d.x + 20, y: d.y + 10 } }
})
await p.evaluate(() => { window.__md = null })
await p.mouse.click(spots.tbl.x, spots.tbl.y)
await p.waitForTimeout(200)
const r1 = await p.evaluate(() => window.__md)
await p.evaluate(() => { window.__md = null })
await p.mouse.click(spots.div.x, spots.div.y)
await p.waitForTimeout(200)
const r2 = await p.evaluate(() => window.__md)
console.log('chain1 层全新 table:', r1 || '✗丢失')
console.log('chain1 层全新 div:  ', r2 || '✗丢失')
console.log('host:', pos.hostCls)
await b.close()
