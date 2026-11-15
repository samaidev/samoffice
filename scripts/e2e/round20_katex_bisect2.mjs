// 非跨页无位移。那 katex css 影响什么？—— katex-display 有 margin，
// katex 字体行高不同 → 文档总高度/分页位置变化 → 表格可能落在不同页位置！
// 但更直接的可能：katex.css 里 .katex { ... } 含 will-change? 搜不到
// pointer-events。换二分 katex.css 规则（249 条）：删后半/前半：
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

// katexKeep: 保留 katex 前 N 条规则（删其余），github 禁
async function katexTrial(keep) {
  await setup(p)
  await p.evaluate(() => {
    const sheets = Array.from(document.querySelectorAll('link[rel=stylesheet]'))
    sheets.forEach(n => { if (/github/.test(n.href || '')) n.disabled = true })
  })
  await p.evaluate(k => {
    const sheet = Array.from(document.styleSheets).find(sh => (sh.href || '').includes('katex'))
    const total = sheet.cssRules.length
    for (let i = total - 1; i >= k; i--) sheet.deleteRule(i)
  }, keep)
  await p.waitForTimeout(400)
  return tryClick()
}

const total = 249
// 二分
console.log('katex 前249(全):', (await katexTrial(total)) ? '✓' : '✗死区!')
console.log('katex 前125:', (await katexTrial(125)) ? '✓' : '✗死区!')
await b.close()
