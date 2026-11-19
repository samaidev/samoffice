// round39 调试：连线坐标系 + 手柄几何
import { chromium } from 'playwright'
import fs from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 150)))

// 从 round39 测试源码里抠出 DOC 构建逻辑（同一段代码）
const para = (text, commentId) => commentId
  ? { type: 'paragraph', inline: [{ type: 'text', content: text, commentId }] }
  : { type: 'paragraph', inline: [{ type: 'text', content: text }] }
const blocks = [{ type: 'heading', level: 1, inline: [{ type: 'text', content: 'round39 测试文档', commentId: 'c1' }] }]
for (let i = 1; i <= 12; i++) blocks.push(para(`第${i}段：长正文填充。${'重复填充文本内容用于分页测试。'.repeat(4)}`))
blocks.push(para('第二页中部锚点。', 'c2'))
for (let i = 13; i <= 18; i++) blocks.push(para(`第${i}段：继续填充正文。${'多期动态合约探讨。'.repeat(3)}`))
blocks.push(para('页尾锚点测试段落。', 'c3'))
blocks.push(para('表格前的段落。', 'c4'))
const cell = (t, isHeader) => ({ inline: [{ type: 'text', content: t }], isHeader: !!isHeader, colSpan: 1, rowSpan: 1 })
blocks.push({ type: 'table', rows: [[cell('列A', true), cell('列B', true), cell('列C', true)], [cell('数据1'), cell('数据2'), cell('数据3')], [cell('数据4'), cell('数据5'), cell('数据6')]] })
blocks.push(para('表格后的段落一。', 'c5'))
const DOC = { meta: { title: 'dbg' }, comments: [
  { id: 'c1', author: 'A', content: '短批注1' },
  { id: 'c2', author: 'B', content: '短批注2' },
  { id: 'c3', author: 'C', content: '短批注3' },
  { id: 'c4', author: 'D', content: '短批注4' },
  { id: 'c5', author: 'E', content: '短批注5' },
], blocks }

await p.goto('http://localhost:18400/?dbg=' + Date.now(), { waitUntil: 'networkidle', timeout: 30000 })
await p.waitForTimeout(1200)
await p.evaluate(d => window.__setDocForTest(d), DOC)
await p.waitForTimeout(3500)

const linkDbg = await p.evaluate(() => {
  const pane = document.querySelector('.comments-pane')
  let scroll = pane.parentElement
  while (scroll && scroll.tagName !== 'HTML') { if (/(auto|scroll)/.test(getComputedStyle(scroll).overflowY)) break; scroll = scroll.parentElement }
  const sr = scroll.getBoundingClientRect()
  const svg = scroll.querySelector('.comment-links-layer')
  const svgR = svg.getBoundingClientRect()
  const papers = [...scroll.querySelectorAll('.pg-paper')].map(el => el.getBoundingClientRect()).sort((a, b) => a.top - b.top)
  const out = { scrollRect: [Math.round(sr.top), Math.round(sr.height)], svgRect: [Math.round(svgR.top), Math.round(svgR.height)], scrollTop: scroll.scrollTop, papers: papers.map(pp => [Math.round(pp.top), Math.round(pp.bottom)]), paths: [] }
  for (const pe of svg.querySelectorAll('path')) {
    const d = pe.getAttribute('d') || ''
    const nums = d.match(/-?[\d.]+/g)?.map(Number) || []
    if (nums.length >= 4) out.paths.push({ y1: nums[1], y2: nums[3], x1: nums[0], x2: nums[2] })
  }
  return out
})
console.log('LINK:', JSON.stringify(linkDbg, null, 1))

const handleDbg = await p.evaluate(() => {
  return [...document.querySelectorAll('.pm-table-handle')].map(h => {
    const r = h.getBoundingClientRect()
    const t = document.querySelector('.tableWrapper table')
    const tr = t?.getBoundingClientRect()
    const host = h.parentElement
    return { parent: (host?.className || host?.tagName || '').toString().slice(0, 30), handleXY: [Math.round(r.left), Math.round(r.top), Math.round(r.width)], tableXY: tr ? [Math.round(tr.left), Math.round(tr.top)] : null, display: getComputedStyle(h).display }
  })
})
console.log('HANDLE:', JSON.stringify(handleDbg))
await b.close()
