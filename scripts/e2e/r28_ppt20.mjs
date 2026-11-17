// hit-test 正常：标题「装备工业的互联网+机遇」就在画布 (404,67) 处！
// DOM 一切正常但 Playwright 截图全白 —— ★ Playwright 的截图问题：
// 中文文本字体加载？不 —— 白色空白包括形状背景。
// ★★ 换终极验证：Chromium CDP Page.captureScreenshot（同 Playwright
// 底层）……相同。改用【SVG/foreignObject 序列化】验证视觉树：
// 检查字体渲染 —— document.fonts.status；以及动画状态（fade-in
// animationName —— 若 animation-fill-mode: backwards 且卡在 0% opacity？
// computed opacity=1 但那是 canvas 的 —— 文字 div 的 opacity？
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
await p.goto(BASE + '/?r=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(2000)
await p.evaluate(async () => {
  const r = await fetch('/upload-test.pptx')
  const buf = await r.arrayBuffer()
  const file = new File([buf], 'test.pptx', { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })
  const dt = new DataTransfer()
  dt.items.add(file)
  document.querySelector('#root > div').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
})
await p.waitForTimeout(8000)
const st = await p.evaluate(() => {
  // 标题文字 div 的完整计算样式
  const canvas = [...document.querySelectorAll('div')].find(d => d.className?.toString().includes('bg-white shadow-xl'))
  const r = canvas.getBoundingClientRect()
  const el = document.elementFromPoint(r.x + 404, r.y + 67)
  const cs = getComputedStyle(el)
  // 字体可用性
  return {
    fontsStatus: document.fonts.status,
    elFont: cs.fontFamily.slice(0, 60),
    elSize: cs.fontSize, elWeight: cs.fontWeight,
    elColor: cs.color,
    // 该元素里实际 TextNode
    textContent: el.textContent?.slice(0, 30),
    childSpanCount: el.querySelectorAll('span').length,
    firstSpanText: el.querySelector('span')?.textContent,
    firstSpanColor: el.querySelector('span') ? getComputedStyle(el.querySelector('span')).color : null,
  }
})
console.log(JSON.stringify(st, null, 1))
await b.close()
