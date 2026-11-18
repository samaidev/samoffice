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
// 滚到文档底部，在 PM 末尾 append 对照元素（文档尾部区域仍需滚动，
// 但这些是 fixed/视口内定位 —— PM 内的用 absolute 于 pm 末尾）
await p.evaluate(() => {
  window.__md = null
  document.addEventListener('mousedown', (e) => { window.__md = 'got@' + e.target.tagName + '#' + (e.target.id || '') }, true)
  const pm = document.querySelector('.ProseMirror')
  // PM 内最后一个子元素后放 table 和 div 对照
  const last = pm.lastElementChild
  const mk = (tag, id, bg) => {
    const el = document.createElement(tag)
    el.id = id
    if (tag === 'table') { el.innerHTML = '<tbody><tr><td>cell-' + id + '</td></tr></tbody>' } else { el.textContent = 'box-' + id }
    Object.assign(el.style, { width: '240px', height: '50px', background: bg, margin: '10px 0', border: '2px solid #333' })
    pm.appendChild(el)
  }
  mk('table', 'r34-tbl-ctrl', '#fdd')
  mk('div', 'r34-div-ctrl', '#dfd')
})
await p.evaluate(() => {
  const pm = document.querySelector('.ProseMirror')
  pm.lastElementChild.scrollIntoView({ block: 'center' })
})
await p.waitForTimeout(800)
const boxes = await p.evaluate(() => {
  const t = document.getElementById('r34-tbl-ctrl').getBoundingClientRect()
  const d = document.getElementById('r34-div-ctrl').getBoundingClientRect()
  return { tbl: { x: t.x + 60, y: t.y + 20 }, div: { x: d.x + 60, y: d.y + 20 } }
})
await p.mouse.click(boxes.tbl.x, boxes.tbl.y)
await p.waitForTimeout(250)
const r1 = await p.evaluate(() => window.__md)
await p.mouse.click(boxes.div.x, boxes.div.y)
await p.waitForTimeout(250)
const r2 = await p.evaluate(() => window.__md)
console.log('PM 内 append 的 table:', r1 || '✗ 丢失')
console.log('PM 内 append 的 div:  ', r2 || '✗ 丢失')
await b.close()
