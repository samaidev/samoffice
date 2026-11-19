// round40 诊断4：二分定位「多少次点击后拖选失效」
import { chromium } from 'playwright'

const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
await p.goto('http://localhost:18400/?sel4=' + Date.now(), { waitUntil: 'networkidle', timeout: 30000 })
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

const dragSelect = async () => {
  const paras = await p.evaluate(() => {
    const ps = [...document.querySelector('.ProseMirror').querySelectorAll('p')]
    const a = ps[1].getBoundingClientRect(), c = ps[3].getBoundingClientRect()
    return { x1: Math.round(a.left + 80), y1: Math.round(a.top + a.height / 2), x2: Math.round(c.left + 80), y2: Math.round(c.top + c.height / 2) }
  })
  await p.mouse.move(paras.x1, paras.y1)
  await p.mouse.down()
  for (let i = 1; i <= 8; i++) { await p.mouse.move(paras.x1 + (paras.x2 - paras.x1) * i / 8, paras.y1 + (paras.y2 - paras.y1) * i / 8); await p.waitForTimeout(30) }
  await p.mouse.up()
  await p.waitForTimeout(200)
  return await p.evaluate(() => String(window.getSelection()).replace(/\n/g, '').length)
}

// 二分：N 次点击（round40 网格同款坐标）后拖选
const gridPts = await p.evaluate(() => {
  const pm = document.querySelector('.ProseMirror')
  const ps = [...pm.querySelectorAll('p')].slice(0, 3)
  const pts = []
  ps.forEach((el) => {
    const r = el.getBoundingClientRect()
    for (let k = 0; k < 5; k++) pts.push({ x: Math.round(r.left + 30 + k * (r.width - 60) / 4), y: Math.round(r.top + r.height * 0.5) })
  })
  return pts
})

for (const N of [1, 3, 5, 10, 15, 25]) {
  // 重载文档清状态
  await p.evaluate(d => window.__setDocForTest(d), DOC)
  await p.waitForTimeout(2500)
  for (let i = 0; i < N; i++) {
    const pt = gridPts[i % gridPts.length]
    await p.mouse.click(pt.x, pt.y)
    await p.waitForTimeout(60)
  }
  const n = await dragSelect()
  console.log(`${N} 次点击后拖选: ${n} 字 ${n > 50 ? '✓' : '✗'}`)
}
await b.close()
