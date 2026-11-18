import { chromium } from 'playwright'
import fs from 'fs'
const DOC = JSON.parse(fs.readFileSync('/home/z/my-project/samoffice/scripts/fixtures/comments_doc.udm.json', 'utf-8'))
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
await p.goto('http://localhost:18400/?r38d=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
await p.evaluate(d => window.__setDocForTest(d), DOC)
await p.waitForTimeout(3000)
const r = await p.evaluate(() => {
  const pane = document.querySelector('.comments-pane')
  const c = document.getElementById('comment-card-c1')
  // offsetParent 链：卡片 absolute，pane position? 若 pane 非 relative，offsetParent 是更外层！
  return {
    panePosition: getComputedStyle(pane).position,
    cardOffsetParent: c.offsetParent ? c.offsetParent.className || c.offsetParent.tagName : null,
    cardOffsetTop: c.offsetTop,
    cardStyleTop: c.style.top,
    paneRectTop: Math.round(pane.getBoundingClientRect().top),
    offsetParentRectTop: c.offsetParent ? Math.round(c.offsetParent.getBoundingClientRect().top) : null,
  }
})
console.log(JSON.stringify(r, null, 1))
await b.close()
