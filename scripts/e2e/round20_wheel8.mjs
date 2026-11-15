// clone 也不行 —— 那 PM 无关！是【这个 table 元素的几何/渲染】本身
// 让 Chromium hit-test 失效。最后变量：表格在文档 y≈9957，而 transform
// 层从 -9203 开始 —— 表格在 transform 层内 19000px 深处。
// ★ 关键测试：把表格【向上移】到 transform 层浅处（改 top/负 margin），
// 看点击是否恢复 —— 若是，就是【transform 层深处的 compositor hit-test
// 裁剪】（合成器纹理层大小限制！层内容超 16000px 会被裁剪 —— 16842 高的层
// 正好超过！）
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
// 滚到表格
await p.evaluate(() => {
  const sc = document.querySelector('.flex-1.overflow-auto')
  const td = document.querySelector('.ProseMirror table td')
  const scRect = sc.getBoundingClientRect()
  const tdTop = td.getBoundingClientRect().top
  sc.scrollTop += tdTop - scRect.top - 300
})
await p.waitForTimeout(2000)
const tryClick = async (label) => {
  await p.evaluate(() => { window.__hit = -1 })
  const box = await p.evaluate(() => {
    const td = document.querySelector('.ProseMirror table td')
    const r = td.getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  })
  if (box.y < 0 || box.y > 890) { console.log(`${label}: (跳过 y=${box.y})`); return false }
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(200)
  const hit = await p.evaluate(() => window.__hit)
  console.log(`${label}: ${hit >= 0 ? '✓' : '✗'}`)
  return hit >= 0
}
await tryClick('基线')
// 实验：把整个 pm-host 上移（负 margin-top 让表格进入层浅处），重新滚到表格点击
await p.evaluate(() => {
  const pm = document.querySelector('.ProseMirror')
  pm.style.marginTop = '-9600px'
})
await p.waitForTimeout(300)
await p.evaluate(() => {
  const sc = document.querySelector('.flex-1.overflow-auto')
  const td = document.querySelector('.ProseMirror table td')
  const scRect = sc.getBoundingClientRect()
  const tdTop = td.getBoundingClientRect().top
  sc.scrollTop += tdTop - scRect.top - 300
})
await p.waitForTimeout(800)
if (await tryClick('上移 9600px 后')) console.log('>>> transform 层深度是罪魁（compositor 纹理裁剪）')
await b.close()
