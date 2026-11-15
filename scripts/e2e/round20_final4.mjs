// visibility 隐藏无效（布局不变）。等等 —— 我该重新验证二分结论：
// 罪魁 #626 是 .sam-math 规则 —— 但 mainTrial 删的是【规则】，
// keep=626 可点、keep=627 死。即规则 #626 存在→死；被删→可点。
// 可 keep=626 时 #626 已保留？不 —— mainTrial(keep) 保留 [0, keep)！
// keep=626 → 保留 0..625，删 626..717 → 可点 = 罪魁在 [626,717)！
// keep=627 → 保留 0..626（含 #626）→ 死 = 罪魁是 #626！✓（我上面推对了）
// 但 .sam-math 怎么都不像能"挡表格"。除非……#626 在 cssRules 里不是
// .sam-math —— media query 的子规则会被展平，序号会漂移！
// 重验：直接删【.sam-math 单条】看效果：
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
console.log('基线:', (await tryClick()) ? '✓' : '✗')
// 精确删 .sam-math 选择器规则
await p.evaluate(() => {
  const sheet = Array.from(document.styleSheets).find(sh => (sh.href || '').includes('index-'))
  for (let i = sheet.cssRules.length - 1; i >= 0; i--) {
    if ((sheet.cssRules[i].selectorText || '') === '.sam-math') { sheet.deleteRule(i); return 'deleted' }
  }
  return 'notfound'
})
await p.waitForTimeout(400)
console.log('删 .sam-math 规则后:', (await tryClick()) ? '✓修复!' : '✗仍在')
await b.close()
