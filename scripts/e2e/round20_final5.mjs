// ★★★ 确认：删 .sam-math 规则 → 表格可点！
// 但删整条规则太粗暴（公式样式也没了）。逐属性二分找 .sam-math 里
// 触发死区的具体属性：
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

// 重写 .sam-math 规则体（逐属性排除）
async function ruleWith(cssBody) {
  await setup(p)
  await p.evaluate(body => {
    const sheet = Array.from(document.styleSheets).find(sh => (sh.href || '').includes('index-'))
    for (let i = sheet.cssRules.length - 1; i >= 0; i--) {
      if ((sheet.cssRules[i].selectorText || '') === '.sam-math') sheet.deleteRule(i)
    }
    sheet.insertRule('.sam-math { ' + body + ' }', 0)
  }, cssBody)
  await p.waitForTimeout(400)
  return tryClick()
}

const full = 'display: block; margin: 8px 0; padding: 4px 8px; background: var(--color-bg-subtle); border: 1px solid var(--color-border); border-radius: 6px; text-align: center; font-family: Cambria Math, Times New Roman, serif'
console.log('完整规则:', (await ruleWith(full)) ? '✓可点(?!)' : '✗死区(复现)')
// 逐项去掉
console.log('- border-radius:', (await ruleWith(full.replace('border-radius: 6px;', ''))) ? '✓可点→罪魁radius!' : '✗')
console.log('- border:', (await ruleWith(full.replace('border: 1px solid var(--color-border);', ''))) ? '✓可点→罪魁border!' : '✗')
console.log('- background:', (await ruleWith(full.replace('background: var(--color-bg-subtle);', ''))) ? '✓可点→罪魁bg!' : '✗')
await b.close()
