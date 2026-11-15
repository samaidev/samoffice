// translateZ 无效。但注意：罪魁是 .sam-math 的样式 —— 它只影响【布局高度】。
// 死区由内容总高决定 → 反向利用：给 .sam-math 减 padding/border（降低总高）
// 看死区是否移动/消失 —— 如果消失证明是【总高度跨过某个临界值】(16384 GPU 纹理
// 或层分块边界)。测试：去掉 .sam-math 的 border+padding（每块省 18px，25 块省 450px）：
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'

async function setup(p) {
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
}

const b = await chromium.launch({ args: ['--no-sandbox'], headless: false })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(20000)

const tryClick = async () => {
  await p.evaluate(() => { window.__hit = -1 })
  const box = await p.evaluate(() => {
    const td = document.querySelector('.ProseMirror table td')
    const r = td.getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  })
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(180)
  return (await p.evaluate(() => window.__hit)) >= 0
}

const scrollToTable = (offset) => p.evaluate(off => {
  const sc = document.querySelector('.flex-1.overflow-auto')
  const td = document.querySelector('.ProseMirror table td')
  const scRect = sc.getBoundingClientRect()
  const tdTop = td.getBoundingClientRect().top
  sc.scrollTop += tdTop - scRect.top - 300 + (off || 0)
}, offset)

await setup(p)
await scrollToTable(0)
await p.waitForTimeout(1800)
console.log('基线:', (await tryClick()) ? '✓' : '✗死区')

// 去掉 .sam-math padding/border（压缩总高）
await p.evaluate(() => {
  document.querySelectorAll('.sam-math').forEach(el => { el.style.padding = '0'; el.style.border = 'none'; el.style.margin = '2px 0' })
})
await p.waitForTimeout(800)
// 重新滚到表格（位置已变）
await scrollToTable(0)
await p.waitForTimeout(800)
console.log('压缩公式块样式后:', (await tryClick()) ? '✓修复!' : '✗')
await b.close()
