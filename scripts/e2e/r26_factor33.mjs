// 注意「编辑器1: 」空 —— TD textContent 为空！第一个实验里 setDocForTest
// 的表格根本没渲染出内容（或渲染失败）。之前所有 factor 实验都在这个
// 基础上跑的 —— 「DEAD」可能只是【点了空白】！
// 立即重验：bisect_check 显示 td=2 存在 —— 但内容空？查个明白：
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 120)))
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
await p.evaluate(() => window.__setDocForTest({ meta: { title: 't' }, blocks: [
  { type: 'p', inline: [{ text: '段落' }] },
  { type: 'table', rows: [
    [{ inline: [{ text: 'A1' }] }, { inline: [{ text: 'B1' }] }],
    [{ inline: [{ text: 'A2' }] }, { inline: [{ text: 'B2' }] }],
  ] },
] }))
await p.waitForTimeout(3500)
const state = await p.evaluate(() => {
  const tds = [...document.querySelectorAll('.ProseMirror td')]
  return {
    tdCount: tds.length,
    texts: tds.map(t => t.textContent),
    td0Rect: tds[0] ? (() => { const r = tds[0].getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } })() : null,
    // 点击 td0 中心：elementFromPoint 命中什么
    hitAtCenter: tds[0] ? (() => { const r = tds[0].getBoundingClientRect(); const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return el?.tagName + '.' + (el?.className || '').toString().slice(0, 20) })() : null,
    // PM doc 里 table 的内容
    pmDocHasTable: window.__pmView.state.doc.textContent.slice(0, 30),
  }
})
console.log(JSON.stringify(state, null, 1))
await b.close()
