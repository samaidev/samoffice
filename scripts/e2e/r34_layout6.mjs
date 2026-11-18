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

// 链式快照：pm → 9 层祖先 + 纸页 + 页脚区
const chain = () => p.evaluate(() => {
  const pm = document.querySelector('.ProseMirror')
  const arr = []
  let cur = pm
  for (let i = 0; i < 10 && cur && cur !== document.body; i++) {
    const r = cur.getBoundingClientRect()
    arr.push({ tag: cur.tagName, cls: (typeof cur.className === 'string' ? cur.className : '').slice(0, 16), y: Math.round(r.y), h: Math.round(r.height) })
    cur = cur.parentElement
  }
  const paper1 = document.querySelector('.pg-paper')
  const paper2 = document.querySelectorAll('.pg-paper')[1]
  return { arr, paper1Y: paper1 ? Math.round(paper1.getBoundingClientRect().y) : null, paper2Y: paper2 ? Math.round(paper2.getBoundingClientRect().y) : null }
})

const c1 = await chain()
// 纯 dispatch（复刻桥行为）
await p.evaluate(() => {
  const v = window.__pmView
  const pos = v.state.selection.constructor.near(v.state.doc.resolve(5090), 1)
  v.dispatch(v.state.tr.setSelection(pos).setMeta('scrollIntoView', false))
})
await p.waitForTimeout(700)
const c2 = await chain()

console.log('=== 祖先链 diff（+40 来源） ===')
for (let i = 0; i < Math.max(c1.arr.length, c2.arr.length); i++) {
  const a = c1.arr[i], b2 = c2.arr[i]
  if (!a || !b2) { console.log(`L${i}: 缺失`); continue }
  const mark = a.y !== b2.y ? '★Y+' + (b2.y - a.y) : '    '
  const markH = a.h !== b2.h ? ' ★H+' + (b2.h - a.h) : ''
  console.log(`L${i} ${mark} ${a.tag}.${a.cls} y:${a.y}→${b2.y} h:${a.h}→${b2.h}${markH}`)
}
console.log('paper1:', c1.paper1Y, '→', c2.paper1Y, c1.paper1Y !== c2.paper1Y ? '★' : '')
console.log('paper2:', c1.paper2Y, '→', c2.paper2Y, c1.paper2Y !== c2.paper2Y ? '★' : '')
await b.close()
