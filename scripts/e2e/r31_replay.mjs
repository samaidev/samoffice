import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
p.on('console', m => { if (m.text().startsWith('R31')) console.log(m.text()) })
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
await p.keyboard.down('Control'); await p.keyboard.press('='); await p.keyboard.up('Control')
await p.waitForTimeout(2500)
const out = await p.evaluate(() => {
  const pm = document.querySelector('.ProseMirror')
  const pmr = pm.getBoundingClientRect()
  const z = 1.1
  // 复刻 measureLineTops(ref)
  const paras = [...pm.children]
  const idx = paras.findIndex(x => (x.textContent || '').includes('参考文献'))
  const el = paras[idx]
  // pg-measuring 模拟（DOM 里 ref 无 margin —— 直接测）
  pm.classList.add('pg-measuring')
  const elTop = el.getBoundingClientRect().top
  const range = document.createRange()
  const res = []
  let charOffset = 0
  let lastTop = -Infinity
  const walk = (node) => {
    if (node.nodeType === 3) {
      const text = node.textContent || ''
      for (let i = 0; i < text.length; i++) {
        range.setStart(node, i); range.setEnd(node, i + 1)
        const rect = range.getBoundingClientRect()
        if (rect.height === 0 && rect.width === 0) continue
        const top = rect.top - elTop
        if (res.length === 0 || top > lastTop + 1) { res.push({ offset: charOffset + i, top: Math.round(top), h: Math.round(rect.height) }); lastTop = top }
        else if (top > lastTop) lastTop = top
      }
      charOffset += text.length
    } else {
      if (node.nodeType === 1 && node.classList?.contains('pg-linebreak')) return
      for (const c of Array.from(node.childNodes)) walk(c)
    }
  }
  walk(el)
  pm.classList.remove('pg-measuring')
  // ref 的自然 blockTop（相对 pm，布局 px）
  const blockTop = (el.getBoundingClientRect().top - pmr.top) / z
  // ref 前面已应用的断点 margin 累计（DOM 实况：pg-linebreak margin 视觉px → 布局px）
  let appliedShift = 0
  for (let i = 0; i < idx; i++) {
    paras[i].querySelectorAll(':scope > .pg-linebreak').forEach(w => { appliedShift += parseFloat(w.style.marginTop) || 0 })
    if (String(paras[i].className).includes('pg-brk')) appliedShift += parseFloat(paras[i].style.marginTop) || 0
  }
  const pg = window.__pg
  return {
    lines: res,
    blockTopRendered: Math.round(blockTop),
    naturalBlockTop: Math.round(blockTop - appliedShift),
    appliedShift: Math.round(appliedShift),
    pageStep: pg.pageStep, per: pg.per,
    // 判定（引擎视角）：blockTop(自然+cumShift=appliedShift) + ln.top + 行高 vs 页底
    lineTop: Math.round(blockTop - appliedShift + appliedShift + (res[0]?.top || 0)),
    lineBottom: Math.round(blockTop + (res[0]?.top || 0) + (res[0]?.h || 27)),
    page13Bottom: 13 * pg.pageStep + pg.per,
  }
})
console.log(JSON.stringify(out, null, 1))
await b.close()
