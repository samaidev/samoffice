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
await p.evaluate(() => { document.querySelector('table').scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(800)
// 克隆表格 → 放进链上每一层（含 PM），fixed 露出视口内，逐个点击
const plan = await p.evaluate(() => {
  window.__hits = {}
  const wrap = document.querySelector('.tableWrapper')
  const chain = []
  let cur = wrap.parentElement
  while (cur && cur !== document.body) { chain.push(cur); cur = cur.parentElement }
  // 每层放一个克隆 table（absolute，错开 y）
  chain.forEach((host, i) => {
    const c = wrap.cloneNode(true)
    c.querySelectorAll('tr').forEach((tr, ri) => { if (ri > 0) tr.remove() }) // 只留1行
    const td = c.querySelector('td')
    if (td) td.textContent = 'L' + i
    Object.assign(c.style, { position: 'absolute', left: '40px', top: (40 + i * 26) + 'px', width: '120px', height: '22px', zIndex: 5000, background: '#fff', border: '1px solid #333', margin: 0 })
    ;(host).appendChild(c)
    c.dataset.layer = String(i)
    window.__hits[i] = false
  })
  return chain.map((h, i) => i + ':' + h.tagName + '.' + (typeof h.className === 'string' ? h.className.split(' ')[0] : '') + (h.style.position ? '[pos]' : ''))
})
await p.waitForTimeout(500)
console.log('层宿主:', plan.join(' | '))
// 逐个点击（都是 absolute，位于宿主内部 40px 左 40+i*26 上 —— 视口坐标需要换算）
const spots = await p.evaluate(() => {
  const out = []
  document.querySelectorAll('[data-layer]').forEach(el => {
    const r = el.getBoundingClientRect()
    out.push({ layer: el.dataset.layer, x: r.x + 20, y: r.y + 8, alive: r.width > 0 && r.height > 0 })
  })
  return out
})
for (const s of spots) {
  if (!s.alive) { console.log('层' + s.layer, '不可见(被裁剪/移出)'); continue }
  await p.mouse.click(s.x, s.y)
  await p.waitForTimeout(150)
}
const hits = await p.evaluate(() => window.__hits)
// 点击可能落到克隆 td 上 —— 通过 mousedown target 的 data-layer 判定
console.log('结果:', JSON.stringify(hits))
await b.close()
