// 主表 CSS 规则二分：删后半 → 测；不行删前半 → 测。迭代到单条规则。
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

// 二分：keepFirst = 保留前 keep 条（删其余）
async function trial(keep) {
  await setup(p)
  await p.evaluate(() => {
    // 禁 github + katex（主表 index-* 保留）
    const sheets = Array.from(document.querySelectorAll('link[rel=stylesheet]'))
    sheets.forEach(n => { if (!/index-/.test(n.href || '')) n.disabled = true })
  })
  await p.evaluate(k => {
    const sheet = Array.from(document.styleSheets).find(sh => (sh.href || '').includes('index-'))
    const total = sheet.cssRules.length
    // 删除 [keep, total) 的规则
    for (let i = total - 1; i >= k; i--) sheet.deleteRule(i)
  }, keep)
  await p.waitForTimeout(400)
  return tryClick()
}

let lo = 0, hi = 717
// 先确认全量 FAIL？（只开主表时 ✓ —— 是禁了 katex/github 后 ✓！）
// 重新理解：只开主表=禁其他=✓！那罪魁在【github.min.css 或 katex.min.css】！
const base = await trial(717) // = 全部主表规则
console.log('主表全量(其余禁):', base ? '✓可点' : '✗死区')
await b.close()
