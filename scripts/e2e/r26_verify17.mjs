// content-visibility:auto → ALIVE！它让 Chromium 跳过视口外内容的渲染，
// 同时 hit-test 走主线程路径。但风险：视口外内容不渲染 → 分页测量
// (offsetHeight) 全坏！分页引擎依赖全文档测量。
// ★★ 折中方案：content-visibility:auto 只加在【表格 wrapper】上 —— 
// 表格在视口内时正常渲染+可点（hit-test 走新路径），视口外跳过。
// 测量：pagination 用 offsetHeight/rect —— contain-intrinsic-size 补底。
// 但表格高度动态 —— 简单值会导致测量错位。
// ★ 更稳的方案：先确认 bug 在「视口内表格」是否只发生在【巨大文档】。
// 小文档表格可点吗？（新建空白文档 → 插入表格 → 点击）如果小文档没事，
// 就给「大文档的表格 wrapper」按需加 content-visibility。
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1000)
// 新建空白文档（关于页 → 新建文档）
await p.evaluate(() => window.__setDocForTest({ meta: { title: 't' }, blocks: [{ type: 'p', inline: ['先写一行字'] }] }))
await p.waitForTimeout(2500)
// 用工具栏插入表格（点击插入选项卡 → 表格按钮）—— 直接调 PM schema 更快
const inserted = await p.evaluate(() => {
  const v = window.__pmView
  if (!v) return 'no-view'
  // 通过 DOM 找插入表格按钮
  const btns = [...document.querySelectorAll('button')]
  const tbtn = btns.find(x => (x.title || '').includes('表格') || x.textContent.includes('表格'))
  return tbtn ? (tbtn.textContent || '').trim() : 'no-btn:' + btns.length
})
console.log('insert table button:', inserted)
await b.close()
