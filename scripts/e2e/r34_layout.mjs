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

const snap = () => p.evaluate(() => {
  const wrap = document.querySelector('.tableWrapper')
  const table = wrap.querySelector('table')
  const trs = Array.from(table.querySelectorAll('tr'))
  // wrapper 前后 6 个兄弟（检测分页 margin 装饰变化）
  let sibs = []
  let cur = wrap
  for (let i = 0; i < 6 && cur; i++) { sibs.push(cur); cur = cur.previousElementSibling }
  cur = wrap.nextElementSibling
  for (let i = 0; i < 3 && cur; i++) { sibs.push(cur); cur = cur.nextElementSibling }
  const sibInfo = sibs.map(el => ({
    cls: (typeof el.className === 'string' ? el.className : '').slice(0, 24),
    style: (el.getAttribute('style') || '').slice(0, 60),
    h: Math.round(el.getBoundingClientRect().height),
    mt: el.style.marginTop, mb: el.style.marginBottom,
  }))
  // PM 侧：表格节点 attrs（row height / colwidth）
  const v = window.__pmView
  let pmAttrs = null
  v.state.doc.forEach((n, off) => {
    if (n.type.name === 'table' && !pmAttrs) {
      const row0 = n.child(0)
      const cell0 = row0.child(0)
      pmAttrs = { tablePos: off, rows: n.childCount, row0Attrs: row0.attrs, cell0Attrs: cell0.attrs }
    }
  })
  return {
    wrapTop: Math.round(wrap.getBoundingClientRect().y),
    wrapH: Math.round(wrap.getBoundingClientRect().height),
    trHeights: trs.map(tr => Math.round(tr.getBoundingClientRect().height)),
    trStyleH: trs.map(tr => tr.style.height || '-'),
    colWidths: Array.from(table.querySelectorAll('col')).map(c => c.style.width || '-'),
    scrollH: Math.round(document.querySelector('.overflow-auto').scrollHeight),
    scrollTop: Math.round(document.querySelector('.overflow-auto').scrollTop),
    sibInfo, pmAttrs,
  }
})

const before = await snap()
// 第一次点击 idx9
const spot = await p.evaluate(() => {
  const c = document.querySelectorAll('table td, table th')[9]
  const r = c.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
await p.mouse.click(spot.x, spot.y)
await p.waitForTimeout(500)
const after = await snap()

const diff = (k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]) ? '★CHANGED' : 'same'
console.log('=== 第一次点击前后 diff ===')
console.log('wrapTop:', before.wrapTop, '→', after.wrapTop, diff('wrapTop'))
console.log('wrapH:', before.wrapH, '→', after.wrapH, diff('wrapH'))
console.log('trHeights:', JSON.stringify(before.trHeights), '→', JSON.stringify(after.trHeights), diff('trHeights'))
console.log('trStyleH:', JSON.stringify(before.trStyleH), '→', JSON.stringify(after.trStyleH), diff('trStyleH'))
console.log('colWidths:', JSON.stringify(before.colWidths), '→', JSON.stringify(after.colWidths), diff('colWidths'))
console.log('scrollH:', before.scrollH, '→', after.scrollH, diff('scrollH'))
console.log('scrollTop:', before.scrollTop, '→', after.scrollTop, diff('scrollTop'))
console.log('pmAttrs:', JSON.stringify(before.pmAttrs) === JSON.stringify(after.pmAttrs) ? 'same' : '★CHANGED\n  before=' + JSON.stringify(before.pmAttrs) + '\n  after=' + JSON.stringify(after.pmAttrs))
const sibB = JSON.stringify(before.sibInfo), sibA = JSON.stringify(after.sibInfo)
console.log('siblings:', sibB === sibA ? 'same' : '★CHANGED')
if (sibB !== sibA) {
  before.sibInfo.forEach((s, i) => { if (JSON.stringify(s) !== JSON.stringify(after.sibInfo[i])) console.log(`  sib[${i}]:`, JSON.stringify(s), '→', JSON.stringify(after.sibInfo[i])) })
}
await b.close()
