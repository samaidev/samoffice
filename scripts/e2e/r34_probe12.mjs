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
  window.__n = 0
  document.addEventListener('mousedown', () => window.__n++, true)
})
await p.evaluate(() => { document.querySelector('table').scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(800)
// 装饰状态快照
const deco = await p.evaluate(() => {
  const pm = document.querySelector('.ProseMirror')
  const kids = Array.from(pm.children)
  const tblIdx = kids.findIndex(k => k.classList?.contains('tableWrapper') || k.querySelector?.('table'))
  const near = kids.slice(Math.max(0, tblIdx - 2), tblIdx + 2).map(k => ({
    cls: (typeof k.className === 'string' ? k.className : '').slice(0, 30),
    style: (k.getAttribute('style') || '').slice(0, 80),
    h: Math.round(k.getBoundingClientRect().height),
    mt: k.style.marginTop,
  }))
  const wrap = document.querySelector('.tableWrapper')
  return {
    tblIdx, near,
    wrapStyle: wrap.getAttribute('style') || 'none',
    wrapCls: wrap.className,
    pgWidgets: pm.querySelectorAll('.pg-linebreak, .pg-brk').length,
  }
})
console.log('装饰快照:', JSON.stringify(deco, null, 1))
// 布局微扰：在 wrapper 前插入 50px 高的空块
await p.evaluate(() => {
  const wrap = document.querySelector('.tableWrapper')
  const spacer = document.createElement('div')
  spacer.style.height = '50px'
  wrap.parentElement.insertBefore(spacer, wrap)
})
await p.waitForTimeout(400)
const box = await p.evaluate(() => {
  const c = document.querySelectorAll('table td, table th')[20]
  const r = c.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
const before = await p.evaluate(() => window.__n)
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(300)
const after = await p.evaluate(() => window.__n)
console.log('位移 50px 后点击:', after > before ? '✓ 恢复（位置绑定）' : '✗ 仍丢（元素绑定）')
await b.close()
