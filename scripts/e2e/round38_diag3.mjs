import { chromium } from 'playwright'
import fs from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DOC = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/comments_doc.udm.json'), 'utf-8'))
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
await p.goto(BASE + '/?r38c=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
await p.evaluate(d => window.__setDocForTest(d), DOC)
await p.waitForTimeout(3000)
const r = await p.evaluate(() => {
  const m = document.querySelector('.comment-mark[data-comment-id="c1"]')
  const c = document.getElementById('comment-card-c1')
  const pane = document.querySelector('.comments-pane')
  const header = pane?.querySelector('.comments-pane-header')
  const mr = m.getBoundingClientRect(), cr = c.getBoundingClientRect(), pr = pane.getBoundingClientRect()
  return {
    markTop: Math.round(mr.top), markH: Math.round(mr.height),
    cardTop: Math.round(cr.top), cardH: Math.round(cr.height), styleTop: c.style.top,
    paneTop: Math.round(pr.top), panePadTop: getComputedStyle(pane).paddingTop,
    headerH: header ? Math.round(header.getBoundingClientRect().height) : null,
    // 面板 padding 12 → 卡片坐标 = paneTop+12+styleTop
    expectTop: Math.round(pr.top + 12 + parseFloat(c.style.top)),
  }
})
console.log(JSON.stringify(r, null, 1))
console.log('预期卡片top(pane+pad+style) =', r.expectTop, ' 实际 =', r.cardTop, r.expectTop === r.cardTop ? '✓坐标系正确' : '✗坐标系错位!')
console.log('锚点top =', r.markTop, ' 差 =', r.cardTop - r.markTop, 'px（卡片中心对齐时差应≈(cardH-markH)/2 =', Math.round((r.cardH - r.markH) / 2), 'px）')
await b.close()
// 追加：卡片 height offset —— 337 vs 预期 349：卡片渲染 top 与 style.top 差 12?
