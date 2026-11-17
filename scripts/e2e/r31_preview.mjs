import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 120)))
p.setDefaultTimeout(30000)
await p.goto(BASE + '/?r=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(2000)
await p.evaluate(async () => {
  const r = await fetch('/test31.docx')
  const buf = await r.arrayBuffer()
  const file = new File([buf], 'test31.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
  const dt = new DataTransfer()
  dt.items.add(file)
  document.querySelector('#root > div').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
})
await p.waitForTimeout(7000)
// 编辑态表格几何
const editTbl = await p.evaluate(() => {
  const pm = document.querySelector('.ProseMirror')
  const pmr = pm.getBoundingClientRect()
  const tbl = pm.querySelector('table')
  if (!tbl) return null
  const r = tbl.getBoundingClientRect()
  return { left: Math.round(r.left - pmr.left), w: Math.round(r.width), pmW: Math.round(pmr.width), align: tbl.getAttribute('data-align'), style: tbl.getAttribute('style')?.slice(0, 90) }
})
console.log('编辑态表格:', JSON.stringify(editTbl))
// 打开打印预览
await p.evaluate(() => { const btn = document.querySelector('[data-testid=word-print-btn]'); btn?.click() })
await p.waitForTimeout(1800)
const pv = await p.evaluate(() => {
  // 预览容器里的表格
  const dialog = [...document.querySelectorAll('div')].find(d => d.className && /print|preview/i.test(String(d.className)) && d.getBoundingClientRect().width > 300)
  const scope = dialog || document.body
  const tbls = [...scope.querySelectorAll('table')]
  if (!tbls.length) return { err: 'no table in preview', scopeCls: String(scope.className).slice(0, 40) }
  const t = tbls[0]
  const r = t.getBoundingClientRect()
  // 预览纸面容器
  const paper = t.closest('div')?.parentElement
  const pr = paper?.getBoundingClientRect()
  return { tblLeft: Math.round(r.left), tblW: Math.round(r.width), paperLeft: pr ? Math.round(pr.left) : null, paperW: pr ? Math.round(pr.width) : null, align: t.getAttribute('data-align'), style: t.getAttribute('style')?.slice(0, 90) }
})
console.log('预览表格:', JSON.stringify(pv))
await p.screenshot({ path: '/tmp/r31_preview.png' })
await b.close()
