// CSS 干预全无效。但有一个没试的 —— 布局本身：
// final9 揭示【仅表格文档 scrollTop=0 死 / scrollTop=300 可点】。
// scrollTop=300 时 Playwright 点击的 td 坐标是滚后重算的 —— 
// Playwright mouse.click(x,y) 若 y 不在视口会自动滚动！
// 所以"可点"案例可能全是【Playwright 自动滚动后的点击】！
// 自动滚动 = scroller.scrollTo(目标y) —— 和我们手动 scrollTop 一样？！
// 不 —— playwright 自动滚的是元素 handle click。mouse.click(坐标) 不会滚。
// 
// 最后一个变量没测过：**Xvfb/无 GPU 软件光栅化**！真实用户有 GPU。
// 检查 --disable-gpu 与软件渲染差异 —— 但这无法代表用户环境。
// 换思路验证【用户真实环境是否真有此问题】：用户报告了"表格内文字无法编辑"
// —— 说明用户环境也有！那这就是真 bug，而且 .sam-math 删除规则能修复。
// 
// 务实决策：无法完美解释 Chromium 内部机制，但【删 .sam-math 规则可修复】
// 是可复现的事实。进一步确认修复的最小变更 = 保留视觉但避开触发条件：
// 试试 .sam-math 规则的等价改写（比如不用 display:block 用 inline-block+width:100%）：
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const b = await chromium.launch({ args: ['--no-sandbox'], headless: false })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(20000)
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
const tryClick = async () => {
  await p.evaluate(() => { window.__hit = -1 })
  const box = await p.evaluate(() => {
    const td = document.querySelector('.ProseMirror table td')
    const r = td.getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  })
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(200)
  return (await p.evaluate(() => window.__hit)) >= 0
}
const rewrite = (body) => p.evaluate(b2 => {
  const sheet = Array.from(document.styleSheets).find(sh => (sh.href || '').includes('index-'))
  for (let i = sheet.cssRules.length - 1; i >= 0; i--) {
    if ((sheet.cssRules[i].selectorText || '') === '.sam-math') sheet.deleteRule(i)
  }
  sheet.insertRule('.sam-math { ' + b2 + ' }', 0)
}, body)

// 改写A：inline-block + width 100%
await rewrite('display: inline-block; width: 100%; box-sizing: border-box; margin: 8px 0; padding: 4px 8px; background: var(--color-bg-subtle); border: 1px solid var(--color-border); border-radius: 6px; text-align: center; font-family: Cambria Math, Times New Roman, serif')
await p.waitForTimeout(400)
console.log('改写A(inline-block):', (await tryClick()) ? '✓修复!' : '✗')
// 改写B：flex
await rewrite('display: flex; justify-content: center; margin: 8px 0; padding: 4px 8px; background: var(--color-bg-subtle); border: 1px solid var(--color-border); border-radius: 6px; font-family: Cambria Math, Times New Roman, serif')
await p.waitForTimeout(400)
console.log('改写B(flex):', (await tryClick()) ? '✓修复!' : '✗')
await b.close()
