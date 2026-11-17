// 走真实 UI 流程：上传文件 → 前端自动路由到 PPT 编辑器 → 截图对比
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
// 直接 UDM 注入（后端已把 pptx 转成 UDM）

const form = new FormData()
form.append('file', new Blob([fs.readFileSync(FILE)]), 'test.pptx')
const r = await fetch(BASE + '/api/doc/open', { method: 'POST', body: form })
const j = await r.json()
console.log('UDM 顶层:', Object.keys(j.document || {}), 'blocks:', j.document?.blocks?.length ?? j.document?.slides?.length ?? '?')
console.log('warnings:', JSON.stringify((j.warnings || []).slice(0, 5)))
await p.evaluate((d) => window.__setDocForTest(d), j.document)
await p.waitForTimeout(5000)
// 当前编辑器类型
const st = await p.evaluate(() => ({
  pptEditor: !!document.querySelector('[class*=ppt], [class*=slide]'),
  bodySlides: document.querySelectorAll('[class*=slide]').length,
  title: document.title,
}))
console.log('UI 状态:', JSON.stringify(st))
await p.screenshot({ path: '/tmp/ppt_sam.png' })
console.log('截图 /tmp/ppt_sam.png')
await b.close()
