import { chromium } from 'playwright'
import fs from 'fs'
const DOC = JSON.parse(fs.readFileSync('/home/z/my-project/samoffice/scripts/fixtures/comments_doc.udm.json', 'utf-8'))
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
p.on('console', m => { if (m.text().includes('r38')) console.log('CONSOLE:', m.text().slice(0, 150)) })
await p.goto('http://localhost:18400/?r38k=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
const before = await p.evaluate(() => ({ has: typeof window.__r38LayoutLog, len: window.__r38LayoutLog ? window.__r38LayoutLog.length : -1 }))
console.log('注入前:', JSON.stringify(before))
await p.evaluate(d => window.__setDocForTest(d), DOC)
await p.waitForTimeout(2500)
const after = await p.evaluate(() => ({ len: window.__r38LayoutLog ? window.__r38LayoutLog.length : -1 }))
console.log('注入后:', JSON.stringify(after))
if (after.len > 0) {
  const log = await p.evaluate(() => window.__r38LayoutLog.slice(-5).map(e => ({ c1: Math.round(e.c1mark || -1), pane: Math.round(e.paneTop || -1), n: e.n })))
  console.log('末 5 次:', JSON.stringify(log))
}
await b.close()
