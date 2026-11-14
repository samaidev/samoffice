// 两半都死 → 不是单属性！.sam-math 有样式就死、无样式可点。
// —— 公式块【无样式时】display:inline(默认) → 高度塌陷 → 表格位置上移！
// 又是位置！罪魁其实是【表格在文档流中的绝对位置】——
// 特定 scrollTop 位置触发了 Chromium 滚动容器的 hit-test 失效。
// 位置一旦变化（公式塌陷/规则删除）→ 表格移位 → 碰巧避开坏区。
// ★ 那么真正的修复方向：这可能与【滚动容器内 transform 缩放层】相关：
// transform:scale 层高 16842px，超过 Chromium 合成层 16384px 分块上限 →
// 16xxx 附近 hit-test 出现空洞。表格区域 y≈9957 没超……
// 但滚动后视口映射的层内绝对位置 = scrollTop+视口y。临界值在哪？
// 测试：同一文档，把表格滚到【不同视口高度】点击，找出死区边界：
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const b = await chromium.launch({ args: ['--no-sandbox'], headless: false })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(20000)
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
  window.__hit = -1
  window.addEventListener('mousedown', () => { window.__hit = 1 }, true)
})
// 表格文档位置
const tdDocY = await p.evaluate(() => {
  const sc = document.querySelector('.flex-1.overflow-auto')
  const td = document.querySelector('.ProseMirror table td')
  return Math.round(td.getBoundingClientRect().top + sc.scrollTop)
})
console.log('表格文档绝对 y:', tdDocY)
// 不同 scrollTop（表格在视口 300..700 处）
const out = []
for (let vpY = 300; vpY <= 700; vpY += 50) {
  await p.evaluate(y => { document.querySelector('.flex-1.overflow-auto').scrollTop = y - 300 + 300 }, tdDocY - vpY + 300 - 300)
  await p.evaluate(y => { document.querySelector('.flex-1.overflow-auto').scrollTop = y }, tdDocY - vpY)
  await p.waitForTimeout(600)
  const box = await p.evaluate(() => {
    const td = document.querySelector('.ProseMirror table td')
    const r = td.getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  })
  await p.evaluate(() => { window.__hit = -1 })
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(150)
  const hit = await p.evaluate(() => window.__hit)
  out.push(`vpY≈${vpY}:${hit >= 0 ? '✓' : '✗'}`)
}
console.log(out.join(' '))
await b.close()
