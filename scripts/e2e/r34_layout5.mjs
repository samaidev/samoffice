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
// 读全部 pg-brk 的 margin-top（decoration 实况）
const pgMarginSnap = () => p.evaluate(() => {
  const v = window.__pmView
  const out = []
  v.dom.querySelectorAll('.pg-brk').forEach(el => {
    out.push(Math.round(parseFloat(el.style.marginTop) || 0))
  })
  return out
})
const m1 = await pgMarginSnap()
const chainSnap = () => window.__chainSnap()
const env1 = await p.evaluate(() => {
  window.__chainSnap = () => {
    const pm = document.querySelector('.ProseMirror')
    const arr = []
    let cur = pm
    for (let i = 0; i < 9 && cur && cur !== document.body; i++) {
      const r = cur.getBoundingClientRect()
      arr.push({ tag: cur.tagName, cls: (typeof cur.className === 'string' ? cur.className : '').slice(0, 18), y: Math.round(r.y), h: Math.round(r.height) })
      cur = cur.parentElement
    }
    return arr
  }
  const prev = pm.previousElementSibling
  return {
    pmY: Math.round(pm.getBoundingClientRect().y),
    prevTag: prev ? prev.tagName : null,
    prevCls: prev ? (typeof prev.className === 'string' ? prev.className.slice(0, 30) : '') : null,
    prevRect: prev ? (() => { const r = prev.getBoundingClientRect(); return { y: Math.round(r.y), h: Math.round(r.height) } })() : null,
    prevText: prev ? (prev.textContent || '').slice(0, 20) : null,
  }
})
console.log('dispatch 前链:', JSON.stringify(await p.evaluate(() => window.__chainSnap())))
// 拦截 dispatch：只发 setSelection（复刻桥的行为，无 heal 干扰）
await p.evaluate(() => {
  const v = window.__pmView
  const pos = v.state.selection.constructor.near(v.state.doc.resolve(5090), 1)
  v.dispatch(v.state.tr.setSelection(pos).setMeta('scrollIntoView', false))
})
await p.waitForTimeout(600)
const m2 = await pgMarginSnap()
const env = await p.evaluate(() => {
  const pm = document.querySelector('.ProseMirror')
  const first = pm.children[0]
  const paper1 = document.querySelector('.pg-paper')
  const host = pm.parentElement
  const cs = getComputedStyle(host)
  return {
    wrapY: Math.round(document.querySelector('.tableWrapper').getBoundingClientRect().y),
    pmY: Math.round(pm.getBoundingClientRect().y),
    prevSib: (() => { const prev = pm.previousElementSibling; return prev ? { tag: prev.tagName, cls: (typeof prev.className === 'string' ? prev.className : '').slice(0, 30), h: Math.round(prev.getBoundingClientRect().height), text: (prev.textContent || '').slice(0, 20) } : null })(),
    firstBlockY: Math.round(first.getBoundingClientRect().y),
    firstBlockCls: (typeof first.className === 'string' ? first.className : '').slice(0, 20),
    paper1Y: paper1 ? Math.round(paper1.getBoundingClientRect().y) : null,
    hostPaddingTop: cs.paddingTop, hostMT: cs.marginTop, hostPos: cs.position,
  }
})
console.log('dispatch 前 pg-brk margins:', JSON.stringify(m1))
console.log('dispatch 后 pg-brk margins:', JSON.stringify(m2))
console.log('dispatch 后链:', JSON.stringify(env))
const afterChain = await p.evaluate(() => window.__chainSnap())
const beforeChain = env1
await b.close()
