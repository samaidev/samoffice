// round40 诊断10：行内拖选后紧接跨行拖选（复刻 round40 序列）
import { chromium } from 'playwright'

const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
await p.goto('http://localhost:18400/?sel10=' + Date.now(), { waitUntil: 'networkidle', timeout: 30000 })
await p.waitForTimeout(1200)
const DOC = {
  meta: { title: 'r40' }, comments: [],
  blocks: [
    { type: 'heading', level: 1, inline: [{ type: 'text', content: 'round40 正文选择测试文档' }] },
    ...Array.from({ length: 8 }, (_, i) => ({
      type: 'paragraph',
      inline: [{ type: 'text', content: `第${i + 1}段落的内容文本。${'这是一段用于测试正文选择行为的较长文本，包含中文汉字与 English words 混排，用于验证光标定位与拖选跨行跨段的正确性。'.repeat(3)}` }],
    })),
  ],
}
await p.evaluate(d => window.__setDocForTest(d), DOC)
await p.waitForTimeout(3500)

const selTest = await p.evaluate(() => {
  const el = [...document.querySelector('.ProseMirror').querySelectorAll('p')][1]
  const r = el.getBoundingClientRect()
  const range = document.createRange()
  range.selectNodeContents(el)
  const rects = [...range.getClientRects()]
  const lineMap = new Map()
  for (const cr of rects) {
    if (!cr.height) continue
    const key = Math.round(cr.top / 6)
    const cur = lineMap.get(key)
    if (!cur) lineMap.set(key, { top: cr.top, bottom: cr.bottom })
    else { cur.top = Math.min(cur.top, cr.top); cur.bottom = Math.max(cur.bottom, cr.bottom) }
  }
  const lines = [...lineMap.values()].sort((a, b) => a.top - b.top)
  const midOf = (i) => (i < lines.length ? Math.round((lines[i].top + lines[i].bottom) / 2) : Math.round(r.bottom - 4))
  return { x1: Math.round(r.left + r.width * 0.45), y1: midOf(1), x2: Math.round(r.left + r.width * 0.55), y2: midOf(3), lines: lines.length }
})
console.log('selTest:', JSON.stringify(selTest))

// instrumentation
await p.evaluate(() => {
  window.__log = []
  document.addEventListener('selectionchange', () => {
    const s = window.getSelection()
    window.__log.push({ collapsed: s.isCollapsed, len: String(s).length, a: s.anchorOffset, f: s.focusOffset })
  })
})

// === round40 序列：先 25 次网格点击 ===
const pts = await p.evaluate(() => {
  const ps = [...document.querySelector('.ProseMirror').querySelectorAll('p')].slice(0, 3)
  const pts = []
  ps.forEach((el) => {
    const r = el.getBoundingClientRect()
    for (let k = 0; k < 5; k++) pts.push({ x: Math.round(r.left + 30 + k * (r.width - 60) / 4), y: Math.round(r.top + r.height * 0.5) })
  })
  return pts
})
for (const pt of pts) { await p.mouse.click(pt.x, pt.y); await p.waitForTimeout(60) }

// 行内拖选（round40 同款）
await p.mouse.move(selTest.x1, selTest.y1)
await p.mouse.down()
await p.mouse.move(selTest.x1 + 40, selTest.y1, { steps: 4 })
await p.mouse.up()
await p.waitForTimeout(0)
const s1 = await p.evaluate(() => String(window.getSelection()))
console.log('行内(+0ms):', s1.length, '字')

// 跨行拖选（改从 p[2] 段落 —— 不同起点，排除同点因素）
const selTest2 = await p.evaluate(() => {
  const el = [...document.querySelector('.ProseMirror').querySelectorAll('p')][2]
  const r = el.getBoundingClientRect()
  const range = document.createRange()
  range.selectNodeContents(el)
  const rects = [...range.getClientRects()]
  const lineMap = new Map()
  for (const cr of rects) {
    if (!cr.height) continue
    const key = Math.round(cr.top / 6)
    const cur = lineMap.get(key)
    if (!cur) lineMap.set(key, { top: cr.top, bottom: cr.bottom })
    else { cur.top = Math.min(cur.top, cr.top); cur.bottom = Math.max(cur.bottom, cr.bottom) }
  }
  const lines = [...lineMap.values()].sort((a, b) => a.top - b.top)
  const midOf = (i) => (i < lines.length ? Math.round((lines[i].top + lines[i].bottom) / 2) : Math.round(r.bottom - 4))
  return { x1: Math.round(r.left + r.width * 0.45), y1: midOf(1), x2: Math.round(r.left + r.width * 0.55), y2: midOf(3) }
})
console.log('selTest2:', JSON.stringify(selTest2))
await p.evaluate(() => { window.__log = [] })
await p.mouse.move(selTest2.x1, selTest2.y1)
await p.mouse.down()
await p.mouse.move(selTest2.x2, selTest2.y2, { steps: 6 })
await p.mouse.up()
await p.waitForTimeout(150)
const out = await p.evaluate(() => ({ sel: String(window.getSelection()), log: window.__log.slice(0, 10) }))
console.log('跨行(不同段):', out.sel.length, '字')
console.log('selectionchange 序列:', JSON.stringify(out.log))

// 第三次拖选（间隔 2s）
await p.waitForTimeout(2000)
await p.mouse.move(selTest.x1, selTest.y1)
await p.mouse.down()
await p.mouse.move(selTest.x2, selTest.y2, { steps: 6 })
await p.mouse.up()
await p.waitForTimeout(150)
console.log('2s 后再拖:', await p.evaluate(() => String(window.getSelection()).length), '字')
await b.close()
