// round40 诊断5：拖选→点击→再拖选（diag3 序列最小化）
import { chromium } from 'playwright'

const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
await p.goto('http://localhost:18400/?sel5=' + Date.now(), { waitUntil: 'networkidle', timeout: 30000 })
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

const getParas = () => p.evaluate(() => {
  const ps = [...document.querySelector('.ProseMirror').querySelectorAll('p')]
  const a = ps[1].getBoundingClientRect(), c = ps[3].getBoundingClientRect()
  return { x1: Math.round(a.left + 80), y1: Math.round(a.top + a.height / 2), x2: Math.round(c.left + 80), y2: Math.round(c.top + c.height / 2) }
})
const dragSelect = async () => {
  const paras = await getParas()
  await p.mouse.move(paras.x1, paras.y1)
  await p.mouse.down()
  for (let i = 1; i <= 8; i++) { await p.mouse.move(paras.x1 + (paras.x2 - paras.x1) * i / 8, paras.y1 + (paras.y2 - paras.y1) * i / 8); await p.waitForTimeout(30) }
  await p.mouse.up()
  await p.waitForTimeout(200)
  return await p.evaluate(() => String(window.getSelection()).replace(/\n/g, '').length)
}

console.log('第1次拖选:', await dragSelect(), '字')
// 一次点击
const pt = await p.evaluate(() => {
  const ps = [...document.querySelector('.ProseMirror').querySelectorAll('p')]
  const r = ps[0].getBoundingClientRect()
  return { x: Math.round(r.left + 30), y: Math.round(r.top + r.height / 2) }
})
await p.mouse.click(pt.x, pt.y)
await p.waitForTimeout(100)
console.log('点击一次后拖选:', await dragSelect(), '字')
// 拖选成功后再点击再拖
await p.mouse.click(pt.x, pt.y)
await p.waitForTimeout(100)
console.log('再次点击后拖选:', await dragSelect(), '字')

// 换个角度：拖选后不点击，直接再拖选
console.log('拖选后直接再拖:', await dragSelect(), '字')

// 检查拖选后 DOM/选区状态
const state = await p.evaluate(() => {
  const sel = window.getSelection()
  const pm = document.querySelector('.ProseMirror')
  return {
    anchorNode: sel.anchorNode?.nodeName, focusNode: sel.focusNode?.nodeName,
    anchorInPM: sel.anchorNode ? pm.contains(sel.anchorNode) : false,
    focusInPM: sel.focusNode ? pm.contains(sel.focusNode) : false,
    isCollapsed: sel.isCollapsed,
    activeEl: document.activeElement?.tagName,
    caretBrowsing: getComputedStyle(document.body).caretColor,
  }
})
console.log('拖选后选区状态:', JSON.stringify(state))
await b.close()
