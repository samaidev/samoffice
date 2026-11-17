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
  let n, bad = 0, samples = []
  while ((n = walker.nextNode())) {
    const t = (n.textContent || '').trim()
    if (!t) continue
    const rg = document.createRange(); rg.selectNodeContents(n)
    for (const r of rg.getClientRects()) {
      if (r.height <= 1 || r.width <= 1) continue
      const top = r.top - pmr.top, bottom = r.bottom - pmr.top
      if (!papers.some(pp => top >= pp.top - 1 && bottom <= pp.bottom + 1)) { bad++; if (samples.length < 3) samples.push({ t: t.slice(0, 10), top: Math.round(top), b: Math.round(bottom) }) }
    }
  }
  return { bad, samples }
})
// 通过 UI 按钮点 zoom in（3824 行的 RibbonButton −，3841 行 +）
const clickZoom = async (label) => {
  await p.evaluate(() => {
    const btns = [...document.querySelectorAll('button')]
    // zoom 按钮在视图标签 —— 先切 View 标签
    const tabs = [...document.querySelectorAll('[data-testid^=ribbon-tab], button, [role=tab]')]
    const viewTab = tabs.find(x => /view|视图/i.test(x.textContent || ''))
    if (viewTab) viewTab.click()
  })
  await p.waitForTimeout(300)
  await p.evaluate(() => {
    const btns = [...document.querySelectorAll('button')]
    const zi = btns.find(x => x.offsetParent !== null && (x.title || '').includes('Zoom in') || (x.textContent || '').trim() === '+')
    if (zi) zi.click()
  })
  await p.waitForTimeout(3000)
}
console.log('初始:', JSON.stringify(await scan()))
await clickZoom()
console.log('zoom+1次:', JSON.stringify(await scan()))
await clickZoom()
console.log('zoom+2次:', JSON.stringify(await scan()))
await b.close()
