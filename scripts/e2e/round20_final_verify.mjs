// 最终因果链测试：.ProseMirror 高 16638px，表格在 ~9957px。
// 罪魁 .sam-math 的 padding(8px)/border(1px)/margin 等让【总高超阈值】或
// 【表格位置跨层边界】。
// 关键实验：在保留罪魁规则的同时，给 .ProseMirror 加 will-change 或
// 提升滚动容器为独立层 —— 经典 workaround：给 scroller 加
// transform: translateZ(0)（强制分层，重置 hit-test 缓存）。
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
    const sc = document.querySelector('.flex-1.overflow-auto')
    const td = document.querySelector('.ProseMirror table td')
    const scRect = sc.getBoundingClientRect()
    const tdTop = td.getBoundingClientRect().top
    sc.scrollTop += tdTop - scRect.top - 300
  })
  await p.waitForTimeout(2000)
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

await setup(p)
console.log('基线(全CSS):', (await tryClick()) ? '✓' : '✗死区')

// Workaround A: scroller 加 translateZ(0)
await p.evaluate(() => { document.querySelector('.flex-1.overflow-auto').style.transform = 'translateZ(0)' })
await p.waitForTimeout(400)
const a = await tryClick()
console.log('A. scroller translateZ(0):', a ? '✓修复!' : '✗')
if (a) await b.close(); process.exit(a ? 0 : 1)
