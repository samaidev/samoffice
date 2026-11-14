// 主表二分（katex 全开，删主表后半 → 若可点则罪魁在删掉的一半）：
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

// mainKeep: 保留主表前 N 条（删其余）；katex 开 github 禁
async function mainTrial(keep) {
  await setup(p)
  await p.evaluate(() => {
    const sheets = Array.from(document.querySelectorAll('link[rel=stylesheet]'))
    sheets.forEach(n => { if (/github/.test(n.href || '')) n.disabled = true })
  })
  await p.evaluate(k => {
    const sheet = Array.from(document.styleSheets).find(sh => (sh.href || '').includes('index-'))
    const total = sheet.cssRules.length
    for (let i = total - 1; i >= k; i--) sheet.deleteRule(i)
  }, keep)
  await p.waitForTimeout(400)
  return tryClick()
}

// 正确方向：keep=717 死区、keep=359/538 可点 → 罪魁在保留集 [keep,717) 被加回才死
// 即罪魁规则号 >= 538。二分：保留 [0, mid) —— 可点 → 罪魁在 [mid, 717)
let lo = 538, hi = 717
while (hi - lo > 1) {
  const mid = Math.floor((lo + hi) / 2)
  const dead = !(await mainTrial(mid)) // 死 → 罪魁在 [0, mid) 之前未删部分? 
  // mainTrial(mid) 删 [mid, 717)：若死 → 罪魁在保留 [0, mid) 且 >= lo → [lo, mid)
  // 若可点 → 罪魁在被删的 [mid, 717)
  console.log('keep=' + mid + ': ' + (dead ? '死' : '可点'))
  if (dead) hi = mid; else lo = mid
}
console.log('罪魁规则 = #' + lo + ' (keep lo 可点, keep lo+1 死)')
console.log('锁定: 规则 #' + lo)
await setup(p)
await p.evaluate(() => {
  const sheets = Array.from(document.querySelectorAll('link[rel=stylesheet]'))
  sheets.forEach(n => { if (/github/.test(n.href || '')) n.disabled = true })
})
const rule = await p.evaluate(idx => {
  const sheet = Array.from(document.styleSheets).find(sh => (sh.href || '').includes('index-'))
  return sheet.cssRules[idx]?.cssText?.slice(0, 300) || '?'
}, lo)
console.log('罪魁规则#' + lo + ':', rule)
await b.close()
