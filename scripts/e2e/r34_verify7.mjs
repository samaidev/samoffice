import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
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
// 脚本监听（与 bridge 同为 window capture）+ 轮询并存
await p.evaluate(() => {
  window.__got = []
  window.addEventListener('mousedown', (e) => {
    // 读 defaultPrevented 在 bridge 之后（先注册的先跑 —— bridge 先注册）
    window.__got.push('script: target=' + e.target.tagName + '.' + (typeof e.target.className === 'string' ? e.target.className.slice(0, 20) : '') + ' pd=' + e.defaultPrevented + ' btn=' + e.button)
  }, true)
  window.__log = []
  const read = () => {
    const sel = window.getSelection()
    const td = sel?.focusNode?.parentElement?.closest('td, th')
    return 'cell=' + (td?.textContent || 'out').slice(0, 6)
  }
  window.__last = read()
  setInterval(() => { const n = read(); if (n !== window.__last) { window.__last = n; window.__log.push(Date.now() % 100000 + ' ' + n) } }, 8)
})
const box = await p.evaluate(() => {
  const cell = document.querySelectorAll('table td, table th')[0]
  const r = cell.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(600)
const out = await p.evaluate(() => ({ got: window.__got, log: window.__log }))
console.log('脚本监听收到:', JSON.stringify(out.got))
console.log('selection 轨迹:', JSON.stringify(out.log))
await b.close()
