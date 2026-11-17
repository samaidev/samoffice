import { chromium } from 'playwright'
import fs from 'fs'
const FILE = '/home/z/my-project/upload/装备工业的互联网 机遇.pptx'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 200)))
p.on('console', m => { if (m.type() === 'error') console.log('CERR:', m.text().slice(0, 120)) })
p.setDefaultTimeout(30000)
await p.goto(BASE + '/?r=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
const form = new FormData()
form.append('file', new Blob([fs.readFileSync(FILE)]), 'test.pptx')
const r = await fetch(BASE + '/api/doc/open', { method: 'POST', body: form })
const j = await r.json()
await p.evaluate((d) => window.__setDocForTest(d), j.document)
await p.waitForTimeout(5000)
const st = await p.evaluate(() => {
  const editors = [...document.querySelectorAll('[class*=editor], [id*=editor]')].map(e => e.className?.toString().slice(0, 30)).slice(0, 5)
  return {
    editors,
    canvas: document.querySelectorAll('canvas').length,
    svg: document.querySelectorAll('svg').length,
    tabs: [...document.querySelectorAll('button')].filter(x => x.offsetParent !== null).map(x => x.textContent?.trim()).filter(t => t && t.length < 8).slice(0, 12),
  }
})
console.log('UI:', JSON.stringify(st, null, 1))
await b.close()
