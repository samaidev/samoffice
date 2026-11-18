import { chromium } from 'playwright'
import fs from 'fs'
const DOC = JSON.parse(fs.readFileSync('/home/z/my-project/samoffice/scripts/fixtures/comments_doc.udm.json', 'utf-8'))
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
await p.goto('http://localhost:18400/?r38l=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
await p.evaluate(d => window.__setDocForTest(d), DOC)
await p.waitForTimeout(2500)
await p.evaluate(() => { window.__r38LayoutLog = [] })
await p.click('.ProseMirror', { position: { x: 300, y: 80 }, force: true, timeout: 8000 })
await p.waitForTimeout(200)
for (let i = 0; i < 30; i++) await p.keyboard.press('Enter')
await p.waitForTimeout(2500)
const r = await p.evaluate(() => {
  const log = window.__r38LayoutLog
  const live = Math.round(document.querySelector('.comment-mark[data-comment-id="c1"]').getBoundingClientRect().top)
  const styleTop = document.getElementById('comment-card-c1').style.top
  return {
    runs: log.length,
    lastC1: log.length ? Math.round(log[log.length - 1].c1mark) : null,
    lastC1Trend: log.slice(-10).map(e => Math.round(e.c1mark)),
    live, styleTop,
  }
})
console.log(JSON.stringify(r, null, 1))
await b.close()
