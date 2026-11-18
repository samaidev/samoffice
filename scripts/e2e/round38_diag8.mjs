import { chromium } from 'playwright'
import fs from 'fs'
const DOC = JSON.parse(fs.readFileSync('/home/z/my-project/samoffice/scripts/fixtures/comments_doc.udm.json', 'utf-8'))
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
await p.goto('http://localhost:18400/?r38h=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
await p.evaluate(d => window.__setDocForTest(d), DOC)
await p.waitForTimeout(2500)
let r = await p.evaluate(() => {
  const marks = [...document.querySelectorAll('.comment-mark[data-comment-id="c1"]')]
  return marks.map(m => {
    const host = m.closest('.pm-host, [key="pm-host"], .ProseMirror')
    let anc = m.parentElement, chain = []
    for (let i = 0; i < 6 && anc; i++) { chain.push(anc.className ? anc.className.slice(0, 24) || anc.tagName : anc.tagName); anc = anc.parentElement }
    return { top: Math.round(m.getBoundingClientRect().top), chain }
  })
})
console.log('注入后 c1 marks:', JSON.stringify(r, null, 1))
await p.click('.ProseMirror', { position: { x: 300, y: 80 }, force: true, timeout: 8000 })
await p.waitForTimeout(200)
for (let i = 0; i < 30; i++) await p.keyboard.press('Enter')
await p.waitForTimeout(2500)
r = await p.evaluate(() => {
  const marks = [...document.querySelectorAll('.comment-mark[data-comment-id="c1"]')]
  return marks.map(m => ({ top: Math.round(m.getBoundingClientRect().top), visible: m.offsetParent !== null }))
})
console.log('Enter 后 c1 marks:', JSON.stringify(r))
await b.close()
