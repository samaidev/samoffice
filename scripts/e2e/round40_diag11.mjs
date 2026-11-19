// round40 诊断11：Enter30 后分页状态与卡片布局链路
import { chromium } from 'playwright'
import fs from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DOC = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/comments_doc.udm.json'), 'utf-8'))
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
await p.goto('http://localhost:18400/?r38d=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
await p.evaluate(d => window.__setDocForTest(d), DOC)
await p.waitForTimeout(3000)

const measure = () => p.evaluate(() => {
  const pane = document.querySelector('.comments-pane')
  let scroll = pane.parentElement
  while (scroll && scroll.tagName !== 'HTML') { if (/(auto|scroll)/.test(getComputedStyle(scroll).overflowY)) break; scroll = scroll.parentElement }
  const sr = scroll.getBoundingClientRect()
  const out = []
  for (const c of pane.querySelectorAll('.comment-card')) {
    const cid = c.id.replace('comment-card-', '')
    const m = scroll.querySelector(`.comment-mark[data-comment-id="${cid}"]`)
    const cr = c.getBoundingClientRect()
    const row = { id: cid, markTop: null, cardTop: Math.round(cr.top - sr.top) }
    if (m) row.markTop = Math.round(m.getBoundingClientRect().top - sr.top)
    out.push(row)
  }
  return { rows: out, papers: [...scroll.querySelectorAll('.pg-paper')].map(el => Math.round(el.getBoundingClientRect().top)), brks: scroll.querySelectorAll('.pg-brk').length, linebrks: scroll.querySelectorAll('.pg-linebreak').length }
})

await p.click('.ProseMirror', { position: { x: 300, y: 80 }, force: true })
await p.waitForTimeout(200)
for (let i = 0; i < 30; i++) await p.keyboard.press('Enter')
await p.waitForTimeout(500)
const mid = await measure()
await p.waitForTimeout(1500)
const fin = await measure()
console.log('Enter 后 500ms:', JSON.stringify(mid.papers), 'pg-brk:', mid.brks, 'linebreak:', mid.linebrks)
console.log('  rows:', JSON.stringify(mid.rows))
console.log('Enter 后 2s:', JSON.stringify(fin.papers), 'pg-brk:', fin.brks, 'linebreak:', fin.linebrks)
console.log('  rows:', JSON.stringify(fin.rows))
await b.close()
