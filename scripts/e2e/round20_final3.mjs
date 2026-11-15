// 高度压缩无效。罪魁 .sam-math 规则的作用可能不是【高度】而是
// 【display:block + background + border-radius → 触发层提升】！
// 每个公式块因 border-radius+background 变成合成层（GPU 分块）。
// 死区或许 = 公式层的【分块覆盖】了表格区域。
// 验证：给所有 .sam-math 强制 will-change:auto + 移除 background/border-radius：
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
const scrollToTable = () => p.evaluate(() => {
  const sc = document.querySelector('.flex-1.overflow-auto')
  const td = document.querySelector('.ProseMirror table td')
  const scRect = sc.getBoundingClientRect()
  const tdTop = td.getBoundingClientRect().top
  sc.scrollTop += tdTop - scRect.top - 300
})

await setup(p)
// 关键实验：直接给 .sam-math 全部 visibility:hidden（保留布局占位）
// —— 若死区消失，说明是公式块的【渲染内容】问题；若仍在，是占位/布局
await scrollToTable()
await p.waitForTimeout(1500)
console.log('基线:', (await tryClick()) ? '✓' : '✗')
await p.evaluate(() => { document.querySelectorAll('.sam-math').forEach(el => { el.style.visibility = 'hidden' }) })
await p.waitForTimeout(500)
console.log('公式块 visibility:hidden 后:', (await tryClick()) ? '✓修复' : '✗仍在')
await b.close()
