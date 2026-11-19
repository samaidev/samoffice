// round40 诊断12：Enter30 后手动触发滚动事件 → 卡片是否恢复对齐（判定布局链路断点）
import { chromium } from 'playwright'
import fs from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DOC = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/comments_doc.udm.json'), 'utf-8'))
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
await p.goto('http://localhost:18400/?r38e=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
await p.evaluate(d => window.__setDocForTest(d), DOC)
await p.waitForTimeout(3000)

const measure = () => p.evaluate(() => {
  const pane = document.querySelector('.comments-pane')
  let scroll = pane.parentElement
  while (scroll && scroll.tagName !== 'HTML') { if (/(auto|scroll)/.test(getComputedStyle(scroll).overflowY)) break; scroll = scroll.parentElement }
  const sr = scroll.getBoundingClientRect()
  return [...pane.querySelectorAll('.comment-card')].map(c => {
    const cid = c.id.replace('comment-card-', '')
    const m = scroll.querySelector(`.comment-mark[data-comment-id="${cid}"]`)
    const cr = c.getBoundingClientRect()
    return { id: cid, markTop: m ? Math.round(m.getBoundingClientRect().top - sr.top) : null, cardTop: Math.round(cr.top - sr.top) }
  })
})

await p.click('.ProseMirror', { position: { x: 300, y: 80 }, force: true })
await p.waitForTimeout(200)
for (let i = 0; i < 30; i++) await p.keyboard.press('Enter')
await p.waitForTimeout(2200)
const before = await measure()
console.log('Enter2s 后:', JSON.stringify(before.map(r => r.id + ':' + (r.markTop - r.cardTop))))
const dbg = await p.evaluate(() => {
  const pane = document.querySelector('.comments-pane')
  let scroll = pane.parentElement
  while (scroll && scroll.tagName !== 'HTML') { if (/(auto|scroll)/.test(getComputedStyle(scroll).overflowY)) break; scroll = scroll.parentElement }
  const sr = scroll.getBoundingClientRect()
  const c1 = document.getElementById('comment-card-c1')
  const m1 = scroll.querySelector('.comment-mark[data-comment-id="c1"]')
  const cr = c1.getBoundingClientRect()
  const mr = m1.getBoundingClientRect()
  const pr = pane.getBoundingClientRect()
  return {
    runs: (window).__clRuns || 0,
    c1: { styleTop: c1.style.top, vis: c1.style.visibility, rectTopRelScroll: Math.round(cr.top - sr.top), rectTopRelPane: Math.round(cr.top - pr.top) },
    mark1RelPane: Math.round(mr.top - pr.top),
    paneOffset: Math.round(pr.top - sr.top),
    paneSticky: getComputedStyle(pane).position,
    paneHeight: Math.round(pr.height),
    scrollClientH: scroll.clientHeight,
  }
})
console.log('c1 现场深度检查:', JSON.stringify(dbg, null, 1))

// 手动触发滚动事件（模拟 1px 滚动 → scroll listener → runCommentsLayout）
await p.evaluate(() => {
  const pane = document.querySelector('.comments-pane')
  let scroll = pane.parentElement
  while (scroll && scroll.tagName !== 'HTML') { if (/(auto|scroll)/.test(getComputedStyle(scroll).overflowY)) break; scroll = scroll.parentElement }
  scroll.dispatchEvent(new Event('scroll'))
})
await p.waitForTimeout(600)
const after = await measure()
console.log('手动scroll后:', JSON.stringify(after.map(r => r.id + ':' + (r.markTop - r.cardTop))))
await b.close()
