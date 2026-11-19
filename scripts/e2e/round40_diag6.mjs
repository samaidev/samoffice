// round40 诊断6：重放 diag3 完整序列（不重载文档），逐步检查
import { chromium } from 'playwright'

const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
const errs = []
p.on('pageerror', e => errs.push(e.message.slice(0, 150)))
await p.goto('http://localhost:18400/?sel6=' + Date.now(), { waitUntil: 'networkidle', timeout: 30000 })
await p.waitForTimeout(1200)
const DOC = {
  meta: {}, comments: [],
  blocks: Array.from({ length: 6 }, (_, i) => ({
    type: 'paragraph',
    inline: [{ type: 'text', content: `第${i + 1}段落的内容文本。${'这是一段用于测试正文选择行为的较长文本，包含中文汉字与 English words 混排，用于验证光标定位与拖选跨行跨段的正确性。'.repeat(2)}` }],
  })),
}
await p.evaluate(d => window.__setDocForTest(d), DOC)
await p.waitForTimeout(3000)

// diag3 序列：selTest 拖选（p[1] rh*1.5 → rh*3.5）→ 行内 → 网格 15 点击 → 跨段
const selTest = await p.evaluate(() => {
  const el = [...document.querySelector('.ProseMirror').querySelectorAll('p')][1]
  const r = el.getBoundingClientRect()
  const rh = r.height / 5
  return { x1: Math.round(r.left + r.width * 0.45), y1: Math.round(r.top + rh * 1.5), x2: Math.round(r.left + r.width * 0.55), y2: Math.round(r.top + rh * 3.5) }
})
await p.mouse.move(selTest.x1, selTest.y1)
await p.mouse.down()
await p.mouse.move(selTest.x2, selTest.y2, { steps: 6 })
await p.mouse.up()
await p.waitForTimeout(250)
console.log('① selTest拖选:', await p.evaluate(() => String(window.getSelection()).length), '字')

await p.mouse.move(selTest.x1, selTest.y1)
await p.mouse.down()
await p.mouse.move(selTest.x1 + 40, selTest.y1, { steps: 4 })
await p.mouse.up()
await p.waitForTimeout(200)
console.log('② 行内拖选:', await p.evaluate(() => String(window.getSelection()).length), '字')

// 网格点击 15 个
const pts = await p.evaluate(() => {
  const ps = [...document.querySelector('.ProseMirror').querySelectorAll('p')].slice(0, 3)
  const pts = []
  ps.forEach((el) => {
    const r = el.getBoundingClientRect()
    for (let k = 0; k < 5; k++) pts.push({ x: Math.round(r.left + 30 + k * (r.width - 60) / 4), y: Math.round(r.top + r.height * 0.5) })
  })
  return pts
})
for (const pt of pts) {
  await p.mouse.click(pt.x, pt.y)
  await p.waitForTimeout(60)
  // 每次点击后检查选区与焦点
  const st = await p.evaluate(() => ({
    collapsed: window.getSelection().isCollapsed,
    anchorIn: window.getSelection().anchorNode ? document.querySelector('.ProseMirror').contains(window.getSelection().anchorNode) : false,
    active: document.activeElement?.closest('.ProseMirror') != null,
  }))
  if (!st.active || !st.anchorIn) console.log('   ⚠️ 点击', JSON.stringify(pt), '后状态异常:', JSON.stringify(st))
}

// 跨段拖选
const paras = await p.evaluate(() => {
  const ps = [...document.querySelector('.ProseMirror').querySelectorAll('p')]
  const a = ps[1].getBoundingClientRect(), c = ps[3].getBoundingClientRect()
  return { x1: Math.round(a.left + 80), y1: Math.round(a.top + a.height / 2), x2: Math.round(c.left + 80), y2: Math.round(c.top + c.height / 2) }
})
// 检查 mousedown target
await p.evaluate(() => {
  window.__md = []
  document.addEventListener('mousedown', e => {
    window.__md.push({ tgt: e.target.tagName, x: e.clientX, y: e.clientY, def: e.defaultPrevented })
  }, { capture: true, passive: true })
})
await p.mouse.move(paras.x1, paras.y1)
await p.mouse.down()
for (let i = 1; i <= 8; i++) { await p.mouse.move(paras.x1 + (paras.x2 - paras.x1) * i / 8, paras.y1 + (paras.y2 - paras.y1) * i / 8); await p.waitForTimeout(30) }
await p.mouse.up()
await p.waitForTimeout(200)
console.log('③ 网格后跨段拖选:', await p.evaluate(() => String(window.getSelection()).length), '字')
console.log('   mousedown 记录:', JSON.stringify(await p.evaluate(() => window.__md)))
console.log('pageerror:', errs.length, errs.slice(0, 3))
await b.close()
