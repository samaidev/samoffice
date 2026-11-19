// round40 诊断7：2段×repeat(3) 文档，网格点击是否触发「收起页间空白」（dblclick 空白带）
import { chromium } from 'playwright'

const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
await p.goto('http://localhost:18400/?sel7=' + Date.now(), { waitUntil: 'networkidle', timeout: 30000 })
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

// 检查分页与纸页几何
const geo = await p.evaluate(() => {
  const papers = [...document.querySelectorAll('.pg-paper')].map(el => el.getBoundingClientRect())
  const ps = [...document.querySelector('.ProseMirror').querySelectorAll('p')].map(el => {
    const r = el.getBoundingClientRect()
    return { top: Math.round(r.top), h: Math.round(r.height), pages: papers.filter(pp => r.bottom > pp.top && r.top < pp.bottom).length }
  })
  return { papers: papers.map(pp => [Math.round(pp.top), Math.round(pp.bottom)]), paras: ps, scrollH: document.querySelector('.overflow-auto').scrollHeight }
})
console.log('纸页:', JSON.stringify(geo.papers))
console.log('段落:', JSON.stringify(geo.paras))

// 网格点击（同 diag3：3 段 slice(0,3) 但只有 2 段 → 10 点）
const pts = await p.evaluate(() => {
  const ps = [...document.querySelector('.ProseMirror').querySelectorAll('p')].slice(0, 3)
  const pts = []
  ps.forEach((el) => {
    const r = el.getBoundingClientRect()
    for (let k = 0; k < 5; k++) pts.push({ x: Math.round(r.left + 30 + k * (r.width - 60) / 4), y: Math.round(r.top + r.height * 0.5), para: (el.textContent || '').slice(0, 4) })
  })
  return pts
})
for (const pt of pts) {
  const before = await p.evaluate(() => [...document.querySelectorAll('.pg-paper')].map(el => Math.round(el.getBoundingClientRect().height)).join(','))
  await p.mouse.click(pt.x, pt.y)
  await p.waitForTimeout(60)
  const after = await p.evaluate(() => [...document.querySelectorAll('.pg-paper')].map(el => Math.round(el.getBoundingClientRect().height)).join(','))
  const collapsed = before !== after
  console.log(`点击 (${pt.x},${pt.y}) ${pt.para}: 纸页高 ${before} → ${after} ${collapsed ? '⚠️ 布局塌缩!' : ''}`)
  if (collapsed) break
}
await b.close()
