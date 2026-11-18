import { chromium } from 'playwright'
import fs from 'fs'
const DOC = JSON.parse(fs.readFileSync('/home/z/my-project/samoffice/scripts/fixtures/comments_doc.udm.json', 'utf-8'))
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
await p.goto('http://localhost:18400/?r38f=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
await p.evaluate(d => window.__setDocForTest(d), DOC)
await p.waitForTimeout(2500)
await p.click('.ProseMirror', { position: { x: 300, y: 80 }, force: true, timeout: 8000 })
await p.waitForTimeout(200)
for (let i = 0; i < 30; i++) await p.keyboard.press('Enter')
const samples = []
for (let i = 0; i < 12; i++) {
  await p.waitForTimeout(300)
  const s = await p.evaluate(() => {
    const m = document.querySelector('.comment-mark[data-comment-id="c1"]')
    const c = document.getElementById('comment-card-c1')
    const pane = document.querySelector('.comments-pane')
    if (!m || !c || !pane) return null
    const mr = m.getBoundingClientRect(), cr = c.getBoundingClientRect(), pr = pane.getBoundingClientRect()
    const expect = Math.round(mr.top - pr.top + mr.height / 2 - cr.height / 2)
    return { markTop: Math.round(mr.top), cardTop: Math.round(cr.top), styleTop: c.style.top.slice(0, 7), expect, err: Math.round(cr.top - (pr.top + 12 + parseFloat(c.style.top))) , alignErr: Math.round((pr.top + parseFloat(c.style.top)) - expect) }
  })
  samples.push({ i: i * 300 + 300, ...s })
}
console.table(samples)
await b.close()
