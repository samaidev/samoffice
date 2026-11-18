import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
p.on('console', (m) => { if (m.text().includes('[bridge]')) console.log('PAGE:', m.text().slice(0, 200)) })
p.on('pageerror', (e) => console.log('PAGEERR:', e.message.slice(0, 200)))
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
await p.evaluate(() => { document.querySelector('table').scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(1000)
// 取 idx9 cell 里第一个文字节点的中点（精确点在 "10" 上）
const spot = await p.evaluate(() => {
  const c = document.querySelectorAll('table td, table th')[9]
  const tn = (function ft(el) { for (const n of el.childNodes) { if (n.nodeType === 3 && n.textContent.trim()) return n; const r = ft(n); if (r) return r } return null })(c)
  const range = document.createRange()
  const tnUse = tn || c
  range.selectNodeContents(tnUse)
  const r = range.getBoundingClientRect()
  // 文字左端 + 2 字符宽
  return { x: r.x + 12, y: r.y + r.height / 2, text: (tnUse.textContent || '').slice(0, 14) }
})
console.log('点击点:', JSON.stringify(spot))
// 双击（真实快速双击）
await p.mouse.dblclick(spot.x, spot.y)
await p.waitForTimeout(500)
const dbl = await p.evaluate(() => {
  const sel = window.getSelection()
  return { text: JSON.stringify(sel?.toString() || ''), collapsed: sel?.isCollapsed, pmSel: window.__pmView?.state?.selection?.constructor?.name }
})
console.log('双击选词:', JSON.stringify(dbl))
await b.close()
