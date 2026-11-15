// 核心矛盾：点 P（正文）→ focus=true；点表格 → focus 丢失且【无 mousedown 事件】。
// 无 mousedown 却引发 focus 变化 —— 说明 mousedown 【被某层消费且默认行为 preventDefault】。
// 一个元素 preventDefault(mousedown) 会阻止 focus —— 谁在 td 上的 mousedown
// preventDefault？—— DocumentEditor 67 行的行列选择插件 nearLeft&&inFirstCol！
// 表格第一列左边 6px —— 点击 (309,541) 在【第一列】且靠近左边？td 宽 42px，
// x=309 是格中心…… 但 nearLeft 阈值 6px 不该命中中心。
// 但是！DocumentEditor.tsx 1314 行：表格图片缩放手柄 mousedown preventDefault ——
// 不在表格。还有 tablePlugins 498 行 resize mousedown preventDefault —— 
// EDGE_TOLERANCE=4px 也不该命中中心。
// 用事件探针验证：在 td 上加 capture mousedown 看它是否到达 td 层 + defaultPrevented：
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const b = await chromium.launch({ args: ['--no-sandbox'], headless: false })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(15000)
const cmsgs = []
p.on('console', m => cmsgs.push(m.text().slice(0, 110)))
await p.goto('http://localhost:18400', { waitUntil: 'networkidle' })
await p.evaluate(() => localStorage.setItem('samoffice_theme', 'light'))
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
const buf = fs.readFileSync(DOC)
const form = new FormData()
form.append('file', new Blob([buf]), 'contract.docx')
const r = await fetch('http://localhost:18400/api/doc/open', { method: 'POST', body: form })
const j = await r.json()
await p.evaluate(d => window.__setDocForTest(d), j.document)
await p.waitForTimeout(2500)
await p.evaluate(() => {
  const sc = document.querySelector('.flex-1.overflow-auto')
  const td = document.querySelector('.ProseMirror table td')
  const scRect = sc.getBoundingClientRect()
  const tdTop = td.getBoundingClientRect().top
  sc.scrollTop += tdTop - scRect.top - 300
})
await p.waitForTimeout(2500)
// 全局 capture 探针（最早时机）+ 各层
await p.evaluate(() => {
  const log = (stage, e) => console.log(`M:${stage}:${e.target.tagName}.${(e.target.className?.toString().slice(0, 8) || '')}:pd=${e.defaultPrevented}`)
  window.addEventListener('mousedown', e => log('win-cap', e), true)
  document.addEventListener('mousedown', e => log('doc-cap', e), true)
  const pm = document.querySelector('.ProseMirror')
  pm.addEventListener('mousedown', e => log('pm-cap', e), true)
  pm.addEventListener('mousedown', e => log('pm-bub', e), false)
  document.addEventListener('mousedown', e => log('doc-bub', e), false)
})
const box = await p.evaluate(() => {
  const td = document.querySelector('.ProseMirror table td')
  const r = td.getBoundingClientRect()
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
})
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(500)
console.log('mousedown 传播:', cmsgs.filter(m => m.startsWith('M:')).join(' | ') || '(一个都没到!)')
await b.close()
