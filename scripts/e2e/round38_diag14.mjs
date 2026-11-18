import { chromium } from 'playwright'
import fs from 'fs'
const DOC = JSON.parse(fs.readFileSync('/home/z/my-project/samoffice/scripts/fixtures/comments_doc.udm.json', 'utf-8'))
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
await p.goto('http://localhost:18400/?r38n=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
await p.evaluate(d => window.__setDocForTest(d), DOC)
await p.waitForTimeout(2500)
const before = await p.evaluate(() => ({ paneScrollTop: document.querySelector('.comments-pane').scrollTop, paneH: document.querySelector('.comments-pane').scrollHeight, paneCH: document.querySelector('.comments-pane').clientHeight }))
await p.click('.ProseMirror', { position: { x: 300, y: 80 }, force: true, timeout: 8000 })
await p.waitForTimeout(200)
for (let i = 0; i < 30; i++) await p.keyboard.press('Enter')
await p.waitForTimeout(2500)
const after = await p.evaluate(() => ({
  paneScrollTop: document.querySelector('.comments-pane').scrollTop,
  paneH: document.querySelector('.comments-pane').scrollHeight,
  paneCH: document.querySelector('.comments-pane').clientHeight,
  markTop: Math.round(document.querySelector('.comment-mark[data-comment-id="c1"]').getBoundingClientRect().top),
  cardRectTop: Math.round(document.getElementById('comment-card-c1').getBoundingClientRect().top),
  cardStyleTop: document.getElementById('comment-card-c1').style.top,
}))
console.log('before:', JSON.stringify(before))
console.log('after:', JSON.stringify(after))
await b.close()
