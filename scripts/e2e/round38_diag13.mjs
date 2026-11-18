import { chromium } from 'playwright'
import fs from 'fs'
const DOC = JSON.parse(fs.readFileSync('/home/z/my-project/samoffice/scripts/fixtures/comments_doc.udm.json', 'utf-8'))
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
await p.goto('http://localhost:18400/?r38m=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
await p.evaluate(d => window.__setDocForTest(d), DOC)
await p.waitForTimeout(2500)
await p.click('.ProseMirror', { position: { x: 300, y: 80 }, force: true, timeout: 8000 })
await p.waitForTimeout(200)
for (let i = 0; i < 30; i++) await p.keyboard.press('Enter')
await p.waitForTimeout(2500)
const r = await p.evaluate(() => ({
  out: window.__r38OutLog,
  mr: window.__r38MrLog,
  styleTop: document.getElementById('comment-card-c1').style.top,
  liveMark: Math.round(document.querySelector('.comment-mark[data-comment-id="c1"]').getBoundingClientRect().top),
}))
console.log(JSON.stringify(r, null, 1))
await b.close()
