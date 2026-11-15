// 发现 comments-pane（批注面板）y=215 h=655 —— 和 scroller 完全重叠！
// 它 pe=auto！若批注面板【透明无内容但盖在上面】且 z 高于内容层 —— 
// elementsFromPoint 里却没它（可能它 pointer-events:auto 但 z-index:auto 排在下层）。
// 查 comments-pane 的 z 与真实遮挡关系 + 内容：
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(15000)
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
const res = await p.evaluate(() => {
  const cp = document.querySelector('.comments-pane')
  if (!cp) return { exists: false }
  const s = getComputedStyle(cp)
  const r = cp.getBoundingClientRect()
  return {
    exists: true,
    rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    z: s.zIndex, pe: s.pointerEvents, pos: s.position, display: s.display,
    opacity: s.opacity, visibility: s.visibility,
    childCount: cp.children.length,
    // pointer-events 在各子元素上
    kidsPE: Array.from(cp.children).slice(0, 3).map(c => `${c.tagName}.${(c.className?.toString().slice(0, 20))} pe=${getComputedStyle(c).pointerEvents}`),
  }
})
console.log(JSON.stringify(res, null, 1))
await b.close()
