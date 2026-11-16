// 覆盖表可点击！同位置同 z 环境 —— 外来 table 完全正常，
// 问题 100% 在「PM 拥有的那个表格子树」本身。
// 再缩小：把 PM 的表格 DOM 原样【移动】到 body（脱离 PM 编辑器），点击它
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
const res = await p.evaluate(() => {
  const td = [...document.querySelectorAll('.ProseMirror td')][2]
  const wrapper = td.closest('.tableWrapper')
  const r = wrapper.getBoundingClientRect()
  // 移动（非克隆）到 body，fixed 定位盖原位
  wrapper.style.position = 'fixed'
  wrapper.style.left = r.x + 'px'
  wrapper.style.top = r.y + 'px'
  wrapper.style.zIndex = '2147483647'
  wrapper.style.background = '#e0f2fe'
  wrapper.style.margin = '0'
  document.body.appendChild(wrapper)
  window.__moved = []
  window.addEventListener('pointerdown', e => window.__moved.push(e.target.tagName), true)
  const rr = wrapper.getBoundingClientRect()
  return { x: rr.x + rr.width / 2, y: rr.y + rr.height / 2 }
})
await p.mouse.click(res.x, res.y)
await p.waitForTimeout(250)
console.log('PM table moved to body →', JSON.stringify(await p.evaluate(() => window.__moved)))
// 对照：把表格移回 PM 内再点（排除「移动本身」的干扰）
await p.evaluate(() => {
  const w = document.querySelector('body > .tableWrapper') || [...document.querySelectorAll('body > div')].find(d => d.className.includes('tableWrapper'))
  if (w) { w.style.position = ''; w.style.left = ''; w.style.top = ''; w.style.zIndex = ''; w.style.background = ''; w.style.margin = '' }
})
await b.close()
