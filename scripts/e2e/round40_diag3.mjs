// round40 诊断3：重放 round40 的拖选坐标，看坐标到底落在哪
import { chromium } from 'playwright'

const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
await p.goto('http://localhost:18400/?sel3=' + Date.now(), { waitUntil: 'networkidle', timeout: 30000 })
await p.waitForTimeout(1200)
const DOC = {
  meta: {}, comments: [],
  blocks: [
    { type: 'paragraph', inline: [{ type: 'text', content: `第1段落的内容文本。${'这是一段用于测试正文选择行为的较长文本，包含中文汉字与 English words 混排，用于验证光标定位与拖选跨行跨段的正确性。'.repeat(3)}` }] },
    { type: 'paragraph', inline: [{ type: 'text', content: `第2段落的内容文本。${'这是一段用于测试正文选择行为的较长文本，包含中文汉字与 English words 混排，用于验证光标定位与拖选跨行跨段的正确性。'.repeat(3)}` }] },
  ],
}
await p.evaluate(d => window.__setDocForTest(d), DOC)
await p.waitForTimeout(3000)

// 精确重放 round40 selTest 的坐标计算
const selTest = await p.evaluate(() => {
  const pm = document.querySelector('.ProseMirror')
  const el = [...pm.querySelectorAll('p')][1]  // round40 用 [1]
  const r = el.getBoundingClientRect()
  const rh = r.height / 5
  const probe = (x, y) => {
    const el2 = document.elementFromPoint(x, y)
    return el2 ? el2.tagName + '.' + (typeof el2.className === 'string' ? el2.className.split(' ')[0] : '') : 'null'
  }
  return {
    rect: { top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) },
    x1: Math.round(r.left + r.width * 0.45), y1: Math.round(r.top + rh * 1.5),
    x2: Math.round(r.left + r.width * 0.55), y2: Math.round(r.top + rh * 3.5),
    hit1: probe(Math.round(r.left + r.width * 0.45), Math.round(r.top + rh * 1.5)),
    hit2: probe(Math.round(r.left + r.width * 0.55), Math.round(r.top + rh * 3.5)),
  }
})
console.log('selTest:', JSON.stringify(selTest))

// 用这些坐标拖
await p.mouse.move(selTest.x1, selTest.y1)
await p.mouse.down()
await p.mouse.move(selTest.x2, selTest.y2, { steps: 6 })
await p.mouse.up()
await p.waitForTimeout(250)
const s = await p.evaluate(() => ({ sel: String(window.getSelection()) }))
console.log('重放拖选:', s.sel.replace(/\n/g, '').length, '字 "' + s.sel.slice(0, 14) + '"')

// round40 的"行内拖选"是 x1,y1 → x1+40,y1
await p.mouse.move(selTest.x1, selTest.y1)
await p.mouse.down()
await p.mouse.move(selTest.x1 + 40, selTest.y1, { steps: 4 })
await p.mouse.up()
await p.waitForTimeout(200)
const s2 = await p.evaluate(() => ({ sel: String(window.getSelection()) }))
console.log('行内拖选:', s2.sel.replace(/\n/g, '').length, '字 "' + s2.sel.slice(0, 14) + '"')

// 关键差异排查：round40 在拖选前做了 dblclick 网格点击吗？不 —— 网格点击用的 p.mouse.click。
// 但 round40 的网格点击点 y 是 r.top + r.height*0.5，x 是 r.left+30+k*(w-60)/4 ——
// 如果段落只有 3-4 行，y 可能落在段间 margin（P 的 rect 含 margin 吗？）
// 再看 round40 与 diag2 的唯一剩余差异：round40 先跑了 25 次网格点击 + 每次 60ms 等待。
// 复现完整序列：
const pts = await p.evaluate(() => {
  const pm = document.querySelector('.ProseMirror')
  const ps = [...pm.querySelectorAll('p')].slice(0, 3)
  const pts = []
  ps.forEach((el, pi) => {
    const r = el.getBoundingClientRect()
    for (let k = 0; k < 5; k++) pts.push({ x: Math.round(r.left + 30 + k * (r.width - 60) / 4), y: Math.round(r.top + r.height * 0.5) })
  })
  return pts
})
for (const pt of pts) {
  await p.mouse.click(pt.x, pt.y)
  await p.waitForTimeout(60)
}
await p.waitForTimeout(300)
// 然后重放跨段拖选（round40 的 paras 坐标）
const paras = await p.evaluate(() => {
  const ps = [...document.querySelector('.ProseMirror').querySelectorAll('p')]
  const a = ps[1].getBoundingClientRect(), c = ps[3] ? ps[3].getBoundingClientRect() : ps[1].getBoundingClientRect()
  return { x1: Math.round(a.left + 80), y1: Math.round(a.top + a.height / 2), x2: Math.round(c.left + 80), y2: Math.round(c.top + c.height / 2) }
})
await p.mouse.move(paras.x1, paras.y1)
await p.mouse.down()
for (let i = 1; i <= 8; i++) { await p.mouse.move(paras.x1 + (paras.x2 - paras.x1) * i / 8, paras.y1 + (paras.y2 - paras.y1) * i / 8); await p.waitForTimeout(30) }
await p.mouse.up()
await p.waitForTimeout(200)
const s3 = await p.evaluate(() => ({ sel: String(window.getSelection()) }))
console.log('网格点击后跨段拖选:', s3.sel.replace(/\n/g, '').length, '字')
await b.close()
