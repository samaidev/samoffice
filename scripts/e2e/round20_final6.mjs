// border/bg/radius 都不是单因 —— 继续二分剩余属性（margin/padding/display/text-align/font-family）：
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

async function ruleWith(cssBody) {
  await setup(p)
  await p.evaluate(body => {
    const sheet = Array.from(document.styleSheets).find(sh => (sh.href || '').includes('index-'))
    for (let i = sheet.cssRules.length - 1; i >= 0; i--) {
      if ((sheet.cssRules[i].selectorText || '') === '.sam-math') sheet.deleteRule(i)
    }
    if (body) sheet.insertRule('.sam-math { ' + body + ' }', 0)
  }, cssBody)
  await p.waitForTimeout(400)
  return tryClick()
}

// 半规则二分
const half1 = 'display: block; margin: 8px 0; padding: 4px 8px'
const half2 = 'background: var(--color-bg-subtle); border: 1px solid var(--color-border); border-radius: 6px; text-align: center; font-family: Cambria Math, Times New Roman, serif'
console.log('无规则(占位):', (await ruleWith('')) ? '✓' : '✗')
console.log('前半(display/margin/padding):', (await ruleWith(half1)) ? '✓' : '✗死区!')
console.log('后半(bg/border/radius/align/font):', (await ruleWith(half2)) ? '✓' : '✗死区!')
await b.close()
