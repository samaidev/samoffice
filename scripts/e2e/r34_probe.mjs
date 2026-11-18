import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
const errs = []
p.on('pageerror', (e) => errs.push(e.message.slice(0, 200)))
p.on('console', (m) => { if (m.type() === 'error') errs.push('CERR: ' + m.text().slice(0, 150)) })
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
const out = await p.evaluate(() => {
  const table = document.querySelector('table')
  if (!table) return { err: 'NO TABLE — upload failed?', errs: window.__lastErr }
  const r = table.getBoundingClientRect()
  const x = r.x + 30, y = r.y + 20
  const hit = document.elementFromPoint(x, y)
  return {
    tableAt: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    vp: { w: window.innerWidth, h: window.innerHeight },
    hitAtTablePos: hit ? hit.tagName + '.' + (hit.className || '').toString().slice(0, 40) : 'null',
    proxyCount: document.querySelectorAll('.pm-table-clickproxy').length,
  }
})
console.log('probe before scroll:', JSON.stringify(out))
await p.evaluate(() => { document.querySelector('table').scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(800)
// 原生点击：不用 mouse.click（它可能触发 pm 特殊处理），用真实坐标
const box = await p.evaluate(() => {
  const cell = document.querySelectorAll('table td, table th')[20]
  const r = cell.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
console.log('click at', JSON.stringify(box))
await p.mouse.move(box.x, box.y)
await p.mouse.down()
await p.waitForTimeout(60)
await p.mouse.up()
await p.waitForTimeout(500)
const st = await p.evaluate(() => {
  const sel = window.getSelection()
  const td = sel?.focusNode?.parentElement?.closest('td, th')
  return {
    activeEl: document.activeElement?.tagName + '.' + (document.activeElement?.className || '').toString().slice(0, 30),
    selCell: (td?.textContent || '【表格外】').slice(0, 10),
    selText: (sel?.focusNode?.textContent || '').slice(0, 12),
    anchorNode: sel?.anchorNode?.nodeName,
    rangeCount: sel?.rangeCount,
  }
})
console.log('after native click:', JSON.stringify(st))
console.log('page errors:', JSON.stringify(errs.slice(0, 5)))
await b.close()
