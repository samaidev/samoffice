import { chromium } from 'playwright'
import fs from 'fs'
const DOC = JSON.parse(fs.readFileSync('/home/z/my-project/samoffice/scripts/fixtures/comments_doc.udm.json', 'utf-8'))
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
await p.goto('http://localhost:18400/?r38o=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
await p.evaluate(d => window.__setDocForTest(d), DOC)
await p.waitForTimeout(3000)
const rows = await p.evaluate(() => {
  const pane = document.querySelector('.comments-pane')
  let scroll = pane.parentElement
  while (scroll && scroll.tagName !== 'HTML') {
    const st = getComputedStyle(scroll)
    if (/(auto|scroll)/.test(st.overflowY) && scroll.scrollHeight > scroll.clientHeight + 4) break
    scroll = scroll.parentElement
  }
  const sr = scroll.getBoundingClientRect()
  const svg = document.querySelector('.comment-links-layer')
  return [...svg.querySelectorAll('g')].map(g => {
    const d = g.querySelector('path').getAttribute('d') || ''
    const m1 = d.match(/M\s+([\d.-]+)\s+([\d.-]+)/)
    const y1 = m1 ? parseFloat(m1[2]) : null
    // 找最近 mark 实际 y
    const marks = [...scroll.querySelectorAll('.comment-mark')]
    let best = null
    for (const mk of marks) {
      const r = mk.getBoundingClientRect()
      const dy = Math.abs(r.top + r.height / 2 - sr.top - y1)
      if (best === null || dy < best.dy) best = { dy: Math.round(dy), my: Math.round(r.top + r.height / 2 - sr.top) }
    }
    return { y1: Math.round(y1), ...best, off: Math.round(y1 - best.my) }
  })
})
console.table(rows)
await b.close()
