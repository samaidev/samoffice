// 布局属性全正常。崩溃边缘……但触摸活/鼠标死/wrapper矩形死 这个组合
// 有一个非常具体的 Chromium 机制我还没排除：**表格是 TableSelection 的
// "drag-select" 目标 —— 且 pageRef 容器上有 React 的 onMouseDown，
// 它 preventDefault 了？** 不 —— React 的 handler 也会让 window 收到 capture 事件。
// 最后未测区域：**pm-table 的 CSS `table-layout: fixed` + colgroup + 
// `border-collapse: separate !important`**（pg-brk-table 规则要求 !important）。
// 等等 —— 早前看到 wrapper class 只是 'tableWrapper'，没有 pg-brk-table！
// 但 .pg-brk-table>table 规则的选择器是【后代选择器】——
// .ProseMirror .pg-brk-table > table —— wrapper 没该类则不生效。
// ★★ 灵光：**`zoom` CSS 属性**！页面用了 css zoom？Chromium 的 zoom 对
// 合成器 hit-test 有历史 bug！查 body/html/editor 的 zoom：
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(800)
const buf = fs.readFileSync(DOC)
const form = new FormData()
form.append('file', new Blob([buf]), 'contract.docx')
const r = await fetch(BASE + '/api/doc/open', { method: 'POST', body: form })
const j = await r.json()
await p.evaluate(d => window.__setDocForTest(d), j.document)
await p.waitForTimeout(3500)
await p.evaluate(() => { [...document.querySelectorAll('.ProseMirror td')][2].scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(1200)
const z = await p.evaluate(() => {
  const out = []
  let el = [...document.querySelectorAll('.ProseMirror td')][2].closest('table')
  while (el && el !== document.documentElement) {
    const s = getComputedStyle(el)
    if (s.zoom !== '1' && s.zoom !== 'normal') out.push(el.tagName + '.' + (el.className || '').toString().slice(0, 14) + ' zoom=' + s.zoom)
    el = el.parentElement
  }
  // 另查 documentElement
  const ds = getComputedStyle(document.documentElement)
  return { zoomed: out, docZoom: ds.zoom, bodyZoom: getComputedStyle(document.body).zoom }
})
console.log('zoom audit:', JSON.stringify(z))
await b.close()
