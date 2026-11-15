// 单开任一都 ✓ —— 死区需要【组合】才触发！三表全开 = ✗。
// 组合二分：主+katex、主+github、katex+github：
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

async function trial(pattern) {
  await setup(p)
  await p.evaluate(pat => {
    const sheets = Array.from(document.querySelectorAll('link[rel=stylesheet]'))
    sheets.forEach(n => { if (!new RegExp(pat).test(n.href || '')) n.disabled = true })
  }, pattern)
  await p.waitForTimeout(400)
  return tryClick()
}

console.log('主+katex:', (await trial('index-|katex')) ? '✓' : '✗死区!')
console.log('主+github:', (await trial('index-|github')) ? '✓' : '✗死区!')
console.log('katex+github:', (await trial('katex|github')) ? '✓' : '✗死区!')
console.log('全部(复现):', (await trial('index-|katex|github|.')) ? '✓' : '✗死区!')
await b.close()
