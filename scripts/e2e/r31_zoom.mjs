import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
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
await p.waitForTimeout(6000)
const scan = () => p.evaluate(() => {
  const pm = document.querySelector('.ProseMirror')
  const pmr = pm.getBoundingClientRect()
  const papers = [...document.querySelectorAll('.pg-paper')].map(el => { const r = el.getBoundingClientRect(); return { top: r.top - pmr.top, bottom: r.bottom - pmr.top } })
  const walker = document.createTreeWalker(pm, NodeFilter.SHOW_TEXT)
  let n, bad = 0
  while ((n = walker.nextNode())) {
    const t = (n.textContent || '').trim()
    if (!t) continue
    const rg = document.createRange(); rg.selectNodeContents(n)
    for (const r of rg.getClientRects()) {
      if (r.height <= 1 || r.width <= 1) continue
      const top = r.top - pmr.top, bottom = r.bottom - pmr.top
      if (!papers.some(pp => top >= pp.top - 1 && bottom <= pp.bottom + 1)) bad++
    }
  }
  return { zoom: String(localStorage.getItem('docZoom') || ''), papers: papers.length, bad }
})
console.log('100%:', JSON.stringify(await scan()))
// 切 zoom 125 → 150
for (const z of [125, 150, 75]) {
  await p.evaluate((zz) => {
    const btns = [...document.querySelectorAll('select, button, [role=combobox]')]
    // 找 zoom 控件（select 或按钮组）
    const sel = document.querySelector('select')
    if (sel) { sel.value = String(zz); sel.dispatchEvent(new Event('change', { bubbles: true })); return }
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z' }))
  }, z)
  await p.waitForTimeout(2500)
  const r = await scan()
  console.log(`${z}%:`, JSON.stringify(r))
}
await b.close()
