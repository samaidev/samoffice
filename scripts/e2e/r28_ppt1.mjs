// samoffice 打开 PPTX → 截图幻灯片面板，与 LibreOffice 真相对比
import { chromium } from 'playwright'
import fs from 'fs'
const FILE = '/home/z/my-project/upload/装备工业的互联网 机遇.pptx'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 200)))
p.on('console', m => { if (m.type() === 'error') console.log('CERR:', m.text().slice(0, 150)) })
p.setDefaultTimeout(30000)
await p.goto(BASE + '/?r=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
const form = new FormData()
form.append('file', new Blob([fs.readFileSync(FILE)]), 'test.pptx')
const r = await fetch(BASE + '/api/doc/open', { method: 'POST', body: form })
console.log('open api:', r.status)
const j = await r.json()
console.log('resp keys:', Object.keys(j).slice(0, 8))
// 检查注入接口
await p.waitForTimeout(1000)
const hasInject = await p.evaluate(() => typeof window.__setDocForTest)
console.log('__setDocForTest:', hasInject)
await b.close()
