// 两处堆栈都正常 pe=auto！但内部无事件。
// 终极验证：Chrome 的 hit-test 认为可点，但输入事件没进页面 ——
// 这种情况只有一种：**元素在视口外**（elementsFromPoint 返回的元素实际
// 是滚动区域内的，但事件坐标系的视口是【另一个滚动上下文】）。
// 等等 —— (700,530) 视口内。除非...整个 window 的 devicePixelRatio / 页面缩放？
// 检查 dpr 和视觉视口：
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
await p.evaluate(() => {
  const sc = document.querySelector('.flex-1.overflow-auto')
  const td = document.querySelector('.ProseMirror table td')
  const scRect = sc.getBoundingClientRect()
  const tdTop = td.getBoundingClientRect().top
  sc.scrollTop += tdTop - scRect.top - 300
})
await p.waitForTimeout(2000)
const env = await p.evaluate(() => {
  // 表格区域的 cross-boundary 信息
  const td = document.querySelector('.ProseMirror table td')
  const r1 = td.getBoundingClientRect()
  // 从 td 向上找 position:relative 的祖先（创建 stacking/scroll 上下文的）
  const anc = []
  let n = td.parentElement
  while (n && n !== document.body) {
    const s = getComputedStyle(n)
    if (s.position !== 'static' || s.transform !== 'none' || s.zoom !== '1' || s.filter !== 'none') {
      const rr = n.getBoundingClientRect()
      anc.push(`${n.tagName}.${(n.className?.toString().slice(0, 22) || '')} pos=${s.position} zoom=${s.zoom} transform=${s.transform.slice(0, 12)} y=${Math.round(rr.y)} h=${Math.round(rr.height)}`)
    }
    n = n.parentElement
  }
  return { dpr: window.devicePixelRatio, tdY: Math.round(r1.y), ancestors: anc }
})
console.log('dpr:', env.dpr, 'tdY:', env.tdY)
console.log('特殊祖先（zoom/transform/relative）:')
env.ancestors.forEach(a => console.log(' ', a))
await b.close()
