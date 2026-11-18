import { chromium } from 'playwright'
import fs from 'fs'
const DOC = JSON.parse(fs.readFileSync('/home/z/my-project/samoffice/scripts/fixtures/comments_doc.udm.json', 'utf-8'))
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
await p.goto('http://localhost:18400/?r38p=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
await p.evaluate(d => window.__setDocForTest(d), DOC)
await p.waitForTimeout(3000)
const r = await p.evaluate(() => {
  const pane = document.querySelector('.comments-pane')
  const ids = ['c1', 'c2', 'c3']
  return ids.map(id => {
    const m = document.querySelector(`.comment-mark[data-comment-id="${id}"]`)
    const c = document.getElementById(`comment-card-${id}`)
    return { id, markTop: Math.round(m.getBoundingClientRect().top), markH: Math.round(m.getBoundingClientRect().height), cardH: Math.round(c.getBoundingClientRect().height), styleTop: c.style.top }
  })
})
console.table(r)
await b.close()
