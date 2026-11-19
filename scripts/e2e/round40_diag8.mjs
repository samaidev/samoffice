// round40 诊断8：多页文档（模拟 round40 主测试：标题+8 段 repeat(3)）行内拖选
import { chromium } from 'playwright'

const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
const errs = []
p.on('pageerror', e => errs.push(e.message.slice(0, 150)))
await p.goto('http://localhost:18400/?sel8=' + Date.now(), { waitUntil: 'networkidle', timeout: 30000 })
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

const geo = await p.evaluate(() => ({
  papers: [...document.querySelectorAll('.pg-paper')].map(el => Math.round(el.getBoundingClientRect().height)).length,
  paras: [...document.querySelector('.ProseMirror').querySelectorAll('p')].length,
}))
console.log('纸页数:', geo.papers, '段落数:', geo.paras)

// === round40 主测试同款：selTest（p[1]，rh*1.5 → rh*3.5 跨行）===
const r1 = await p.evaluate(() => {
  const el = [...document.querySelector('.ProseMirror').querySelectorAll('p')][1]
  const r = el.getBoundingClientRect()
  const rh = r.height / 5
  return { x1: Math.round(r.left + r.width * 0.45), y1: Math.round(r.top + rh * 1.5), x2: Math.round(r.left + r.width * 0.55), y2: Math.round(r.top + rh * 3.5), top: Math.round(r.top), h: Math.round(r.height), lineH: Math.round(rh) }
})
console.log('selTest 坐标:', JSON.stringify(r1))
await p.mouse.move(r1.x1, r1.y1)
await p.mouse.down()
await p.mouse.move(r1.x2, r1.y2, { steps: 6 })
await p.mouse.up()
await p.waitForTimeout(250)
console.log('① 跨行拖选(无前置点击):', await p.evaluate(() => String(window.getSelection()).replace(/\n/g, '').length), '字')

// === round40 完整前置：网格 25 点击 ===
const pts = await p.evaluate(() => {
  const ps = [...document.querySelector('.ProseMirror').querySelectorAll('p')].slice(0, 3)
  const pts = []
  ps.forEach((el) => {
    const r = el.getBoundingClientRect()
    for (let k = 0; k < 5; k++) pts.push({ x: Math.round(r.left + 30 + k * (r.width - 60) / 4), y: Math.round(r.top + r.height * 0.5) })
  })
  return pts
})
let caretOK = 0
for (const pt of pts) {
  await p.mouse.click(pt.x, pt.y)
  await p.waitForTimeout(60)
  const st = await p.evaluate(() => {
    const sel = window.getSelection()
    const focused = document.activeElement?.closest('.ProseMirror') != null
    return { len: String(sel).length, focused }
  })
  if (st.focused && st.len === 0) caretOK++
}
console.log('网格点击 caret 成功:', caretOK + '/' + pts.length)

// 网格点击后重测 selTest 坐标（round40 在点击后没有重测！它用点击前测的坐标 —— 检查偏移）
const r2 = await p.evaluate(() => {
  const el = [...document.querySelector('.ProseMirror').querySelectorAll('p')][1]
  const r = el.getBoundingClientRect()
  const rh = r.height / 5
  return { x1: Math.round(r.left + r.width * 0.45), y1: Math.round(r.top + rh * 1.5), x2: Math.round(r.left + r.width * 0.55), y2: Math.round(r.top + rh * 3.5), top: Math.round(r.top) }
})
console.log('点击后 selTest 坐标:', JSON.stringify(r2), 'y 偏移:', r2.y1 - r1.y1)

// 用旧坐标拖（round40 主测试正是这么做的）
await p.mouse.move(r1.x1, r1.y1)
await p.mouse.down()
await p.mouse.move(r1.x2, r1.y2, { steps: 6 })
await p.mouse.up()
await p.waitForTimeout(250)
console.log('② 网格后旧坐标跨行拖选:', await p.evaluate(() => String(window.getSelection()).replace(/\n/g, '').length), '字')

// 用新坐标拖
await p.mouse.move(r2.x1, r2.y1)
await p.mouse.down()
await p.mouse.move(r2.x2, r2.y2, { steps: 6 })
await p.mouse.up()
await p.waitForTimeout(250)
console.log('③ 网格后新坐标跨行拖选:', await p.evaluate(() => String(window.getSelection()).replace(/\n/g, '').length), '字')
console.log('pageerror:', errs.length, errs.slice(0, 2))
await b.close()
