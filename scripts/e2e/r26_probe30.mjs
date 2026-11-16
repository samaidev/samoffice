// GPU 合成层提升无效。那么「合成器鼠标 hit-test 失效」的触发者未必是表格层
// —— 而可能是【编辑器缩放层的 transform】+ 表格这一组合。
// 之前 transform=none 实验失败过（probe4）—— 但那次没清 rAF 循环？
// 重新严谨实验：把缩放层 transform 彻底去掉 + 等待 + 点击。
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
// 定位缩放层（pm-host 的父）并归零 transform
const t = await p.evaluate(() => {
  const host = window.__pmView.dom.parentElement // pm-host
  const scaler = host.parentElement
  window.__scaler = scaler
  window.__saved = scaler.style.transform
  scaler.style.transform = 'none'
  return { hadTransform: window.__saved }
})
console.log('scaler had:', JSON.stringify(t))
await p.waitForTimeout(1000)
await p.evaluate(() => { [...document.querySelectorAll('.ProseMirror td')][2].scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(800)
await p.evaluate(() => { window.__e = []; window.addEventListener('pointerdown', () => window.__e.push(1), { capture: true, passive: true }) })
const box = await p.evaluate(() => { const r = [...document.querySelectorAll('.ProseMirror td')][2].getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(250)
console.log('scaler transform=none →', (await p.evaluate(() => window.__e.length)) > 0 ? 'ALIVE' : 'dead')
await p.evaluate(() => { window.__scaler.style.transform = window.__saved })
await b.close()
