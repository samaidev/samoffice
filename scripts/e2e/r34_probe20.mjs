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
  document.addEventListener('mousedown', (e) => { window.__md = 'got@' + e.target.tagName }, true)
})
await p.evaluate(() => { document.querySelector('table').scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(800)
// 逐步把 wrapper 往上挪（每步挪到 parent 的 parent，fixed 定位在死区原位）
// 层级链：wrapper(0) → ProseMirror(1) → width100%(2) → flex(3) → z1(4) → 794(5) → mx-auto(6)
let step = 0
const MAX = 7
while (step < MAX) {
  const alive = await p.evaluate(() => {
    // 每轮：把 wrapper 挪到 body，fixed 定位，测可点性，然后挪回原父级原位置
    const wrap = document.querySelector('.tableWrapper')
    if (!wrap) return 'nowrap'
    const parent = wrap.parentElement
    const next = wrap.nextSibling
    const savedCss = wrap.getAttribute('style') || ''
    Object.assign(wrap.style, { position: 'fixed', left: '120px', top: '300px', zIndex: '1500', background: '#fff' })
    document.body.appendChild(wrap)
    return { tag: parent.tagName + '.' + (typeof parent.className === 'string' ? parent.className.split(' ')[0] : ''), parent, next, savedCss, wrap }
  })
  // 在 body 位置点击
  await p.mouse.click(300, 350)
  await p.waitForTimeout(200)
  const r1 = await p.evaluate(() => window.__md)
  // 挪回去
  await p.evaluate(() => { window.__md = null })
  console.log(`step${step} 在body:`, r1 || '✗')
  // 放回：直接放回原父原位
  await p.evaluate(() => {
    const wrap = document.querySelector('.tableWrapper')
    // 原父 = ProseMirror（body 里的是我们的临时宿主）
    const pm = document.querySelector('.ProseMirror')
    if (wrap.parentElement !== pm) pm.appendChild(wrap)
    wrap.style.cssText = ''
  })
  await p.waitForTimeout(300)
  step++
  if (step >= 2) break // 每轮一样，做两轮即可确认可重复
}
await b.close()
