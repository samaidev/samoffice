import { chromium } from 'playwright'
import fs from 'fs'
const DOC = JSON.parse(fs.readFileSync('/home/z/my-project/samoffice/scripts/fixtures/comments_doc.udm.json', 'utf-8'))
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
await p.goto('http://localhost:18400/?r38e=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
await p.evaluate(d => window.__setDocForTest(d), DOC)
const samples = []
for (let t = 0; t <= 4000; t += 400) {
  await p.waitForTimeout(t === 0 ? 0 : 400)
  const s = await p.evaluate(() => {
    const m = document.querySelector('.comment-mark[data-comment-id="c1"]')
    const c = document.getElementById('comment-card-c1')
    const pane = document.querySelector('.comments-pane')
    if (!m || !c || !pane) return null
    const mr = m.getBoundingClientRect(), cr = c.getBoundingClientRect(), pr = pane.getBoundingClientRect()
    return { markTop: Math.round(mr.top), cardTop: Math.round(cr.top), alignErr: Math.round(cr.top - (mr.top + 5 - cr.height / 2)) }
  })
  samples.push({ t, ...s })
}
console.table(samples)
await b.close()
