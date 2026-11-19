// round39 截图：批注面板同页约束 + 表格手柄拖拽指示线
import { chromium } from 'playwright'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
p.setDefaultTimeout(30000)

const para = (text, commentId) => commentId
  ? { type: 'paragraph', inline: [{ type: 'text', content: text, commentId }] }
  : { type: 'paragraph', inline: [{ type: 'text', content: text }] }
const blocks = [{ type: 'heading', level: 1, inline: [{ type: 'text', content: 'round39 视觉检查', commentId: 'c1' }] }]
for (let i = 1; i <= 10; i++) blocks.push(para(`第${i}段：长正文填充。${'重复填充文本内容用于分页测试。'.repeat(4)}`))
blocks.push(para('第二页锚点段落，批注卡片应当显示在本页范围内。', 'c2'))
for (let i = 11; i <= 16; i++) blocks.push(para(`第${i}段：继续填充。${'多期动态合约探讨。'.repeat(3)}`))
const cell = (t, isHeader) => ({ inline: [{ type: 'text', content: t }], isHeader: !!isHeader, colSpan: 1, rowSpan: 1 })
blocks.push({ type: 'table', rows: [[cell('列A', true), cell('列B', true), cell('列C', true)], [cell('数据1'), cell('数据2'), cell('数据3')]] })
blocks.push(para('表后段落。', 'c3'))
const DOC = { meta: { title: 'shot' }, comments: [
  { id: 'c1', author: '审稿人A', content: '标题批注。' },
  { id: 'c2', author: '审稿人B', content: '本页批注：卡片与连线都应限制在本纸页内，不跨页。' },
  { id: 'c3', author: '审稿人C', content: '表后批注。' },
], blocks }

await p.goto('http://localhost:18400/?shot=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
await p.evaluate(d => window.__setDocForTest(d), DOC)
await p.waitForTimeout(3500)

// 图1：滚动到第 2 页锚点处
await p.evaluate(() => {
  const m = document.querySelector('.comment-mark[data-comment-id="c2"]')
  const scroll = m?.closest('.overflow-auto')
  if (m && scroll) scroll.scrollTop = Math.max(0, m.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop - 250)
})
await p.waitForTimeout(1000)
await p.screenshot({ path: path.join(__dirname, 'shots-r39', 'r39-page2-comments.png') })

// 图2：悬停表格 + 手柄显示
await p.evaluate(() => {
  const t = document.querySelector('.tableWrapper table')
  const scroll = t?.closest('.overflow-auto')
  if (t && scroll) scroll.scrollTop = Math.max(0, t.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop - 150)
})
await p.waitForTimeout(600)
const tbl = await p.evaluate(() => {
  const t = document.querySelector('.tableWrapper table')
  const r = t.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + 8 }
})
await p.mouse.move(tbl.x, tbl.y)
await p.waitForTimeout(400)
await p.screenshot({ path: path.join(__dirname, 'shots-r39', 'r39-table-handle.png') })

// 图3：拖拽中（指示线）
const handle = await p.evaluate(() => {
  const h = document.querySelector('.pm-table-handle')
  const r = h.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
})
const target = await p.evaluate(() => {
  const pm = document.querySelector('.ProseMirror')
  const first = pm.children[0]
  const r = first.getBoundingClientRect()
  return { x: r.left + 100, y: r.top + 5 }
})
await p.mouse.move(handle.x, handle.y)
await p.waitForTimeout(150)
await p.mouse.down()
await p.waitForTimeout(100)
for (let i = 1; i <= 10; i++) {
  await p.mouse.move(handle.x + (target.x - handle.x) * i / 10, handle.y + (target.y - handle.y) * i / 10)
  await p.waitForTimeout(35)
}
await p.waitForTimeout(250)
await p.screenshot({ path: path.join(__dirname, 'shots-r39', 'r39-drag-indicator.png') })
await p.mouse.up()
await p.waitForTimeout(600)
console.log('shots saved')
await b.close()
