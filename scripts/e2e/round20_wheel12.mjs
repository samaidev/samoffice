// 只开主表 ✓ —— katex/github 无罪。主表 717 条二分：
// 策略：CSSStyleSheet.deleteRule 逐半删除（不可逆但每次重载）。
// 更快：只删【与 table/td/th/prosemirror 相关】的规则先试。
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
await setup(p)

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
// 只开主表 + 按选择器关键词分组删除
// 第一轮：删所有含 'table' 的规则
const delRules = (keywords) => p.evaluate(kws => {
  // 禁用的 link 也会从 styleSheets 里消失 —— 按 href 找主表
  const sheet = Array.from(document.styleSheets).find(sh => (sh.href || '').includes('index-'))
  if (!sheet) return -1
  let deleted = 0
  for (let i = sheet.cssRules.length - 1; i >= 0; i--) {
    const rule = sheet.cssRules[i]
    const sel = rule.selectorText || (rule.cssText || '').slice(0, 100)
    if (kws.some(k => sel.includes(k))) { sheet.deleteRule(i); deleted++ }
  }
  return deleted
}, keywords)

// 基线：只开主表 → 应该 ✓（复现上轮）
await p.evaluate(() => {
  const sheets = Array.from(document.querySelectorAll('link[rel=stylesheet], style'))
  sheets.forEach(n => n.disabled = true)
  sheets[2].disabled = false
})
await p.waitForTimeout(300)
console.log('只开主表:', (await tryClick()) ? '✓' : '✗')
// 删 table 相关规则
const n1 = await delRules(['table', 'td', 'th '])
await p.waitForTimeout(300)
const r1 = await tryClick()
console.log(`删 table 相关 ${n1} 条后: ${r1 ? '✓' : '✗'}`)
if (!r1) {
  // 不是 table 规则 → 重来，删 ProseMirror 相关
  await setup(p)
  await p.evaluate(() => {
    const sheets = Array.from(document.querySelectorAll('link[rel=stylesheet], style'))
    sheets.forEach(n => n.disabled = true)
    sheets[2].disabled = false
  })
  const n2 = await delRules(['ProseMirror'])
  await p.waitForTimeout(300)
  const r2 = await tryClick()
  console.log(`删 ProseMirror 相关 ${n2} 条后: ${r2 ? '✓' : '✗'}`)
}
await b.close()
