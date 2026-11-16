// 二分 DOM：逐层移除表格祖先的嫌疑属性。这次暴力二分：
// 1) 把表格移到 body 直接子元素（脱离所有层）看点击是否恢复
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
await p.waitForTimeout(1500)

// 克隆表格到 body（fixed 定位，盖在原位置）
await p.evaluate(() => {
  const td = [...document.querySelectorAll('.ProseMirror td')][2]
  const table = td.closest('table')
  const r = table.getBoundingClientRect()
  const clone = table.cloneNode(true)
  clone.style.cssText = `position:fixed; left:${r.x}px; top:${r.y}px; z-index:99999; background:white; transform:none`
  document.body.appendChild(clone)
  window.__cloneRect = { x: r.x, y: r.y }
})
await p.waitForTimeout(500)
await p.evaluate(() => { window.__t3 = []; window.addEventListener('pointerdown', e => window.__t3.push(e.target.tagName), true) })
const box = await p.evaluate(() => {
  const cl = [...document.querySelectorAll('body > table')].pop()
  const r = cl.getBoundingClientRect()
  return { x: r.x + r.width * 0.6, y: r.y + r.height * 0.55 }
})
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(250)
console.log('cloned-to-body events:', JSON.stringify(await p.evaluate(() => window.__t3)))
await b.close()
