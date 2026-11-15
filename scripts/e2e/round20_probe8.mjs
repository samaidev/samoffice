// move 到表格位置后连【pointermove】都一个没有！但之前 move 到 (200,100) 空白处事件正常。
// 等等 —— (315, 325)。视口 1360x900。scrollIntoView(block:center) 之后表格在视口中部。
// 但【之前有一次】试验（round20_focus_probe）里点击正文段落是成功的 —— 那时候
// paragraph 在视口什么位置？也许整个【编辑器区域】的鼠标事件都被某个东西吞了，
// 而空白处 (200,100) 是顶部工具栏区域之外……
// 关键对照：点击正文段落现在还行吗？分三处点击：顶栏、正文段落、表格单元格
import { chromium } from 'playwright'
import fs from 'fs'

const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(15000)
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
  window.__evCount = {}
  for (const t of ['pointerdown', 'mousedown']) {
    window.addEventListener(t, () => { window.__evCount[t] = (window.__evCount[t] || 0) + 1 }, true)
  }
})
// 三个点位
const pts = await p.evaluate(() => {
  const td = document.querySelector('.ProseMirror table td')
  const r1 = td.getBoundingClientRect()
  // 正文段落：找表格后面最近的段落（视口内）
  const paras = Array.from(document.querySelectorAll('.ProseMirror > p'))
  const visPara = paras.find(pp => { const rr = pp.getBoundingClientRect(); return rr.top > 0 && rr.bottom < window.innerHeight })
  const r2 = visPara ? visPara.getBoundingClientRect() : null
  return {
    cell: { x: Math.round(r1.x + r1.width / 2), y: Math.round(r1.y + r1.height / 2), top: Math.round(r1.top) },
    para: r2 ? { x: Math.round(r2.x + 30), y: Math.round(r2.y + r2.height / 2), top: Math.round(r2.top) } : null,
  }
})
console.log('点位:', JSON.stringify(pts))
for (const [name, pt] of Object.entries(pts).filter(([, v]) => v)) {
  await p.evaluate(c => { window.__evCount = {} }, null)
  await p.mouse.click(pt.x, pt.y)
  await p.waitForTimeout(300)
  const cnt = await p.evaluate(() => window.__evCount)
  console.log(`点击${name}@${pt.x},${pt.y}(top=${pt.top}):`, JSON.stringify(cnt))
}
await b.close()
