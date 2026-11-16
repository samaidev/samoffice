// 原生表格可点。逐步逼近：打开文档后，在 body 注入【同样的原生表格】盖在
// TD 位置上 —— 如果此时也点不动 → 有"全屏元素"挡住（但 pe=none 也不该挡）；
// 如果点得动 → 100% 是 PM 表格子树本身（PM 拥有的 DOM）出问题。
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(800)
const buf = fs.readFileSync(DOC)
const form = new FormData()
form.append('file', new Blob([buf]), 'contract.docx')
const r = await fetch(BASE + '/api/doc/open', { method: 'POST', body: form })
const j = await r.json()
await p.evaluate(d => window.__setDocForTest(d), j.document)
await p.waitForTimeout(3500)
await p.evaluate(() => { [...document.querySelectorAll('.ProseMirror td')][2].scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(1200)
// 注入原生表覆盖在 PM 表格之上
const pos = await p.evaluate(() => {
  const r = [...document.querySelectorAll('.ProseMirror td')][2].getBoundingClientRect()
  const t = document.createElement('table')
  t.border = '1'
  t.style.cssText = `position:fixed;left:${r.x}px;top:${r.y}px;width:${r.width}px;height:${r.height}px;z-index:2147483647;background:#fffde7`
  t.innerHTML = '<tr><td>COVER</td></tr>'
  document.body.appendChild(t)
  window.__orig = []
  window.addEventListener('pointerdown', e => window.__orig.push(e.target.tagName + '.' + (e.target.textContent || '').slice(0, 5)), true)
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
await p.mouse.click(pos.x, pos.y)
await p.waitForTimeout(200)
console.log('cover-table on doc-loaded page →', JSON.stringify(await p.evaluate(() => window.__orig)))
await b.close()
