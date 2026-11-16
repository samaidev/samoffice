// 死区边界 = 表格顶部（内容跟随，非屏幕固定）。即：**表格 wrapper 的整个
// 矩形区域**对鼠标 hit-test 不可见，其它区域正常。
// 触摸可点 + elementFromPoint 可点 + CDP DOM hit-test 可点 ——
// 仅「合成器鼠标 hit-test」看不见这个 table 层。
// 这就是 Chromium 的已知 bug：crbug.com/…「table with position:relative
// wrapper + transform ancestor → compositor touch-action/hit-test 失效」？
// 不深究浏览器内部。工程解法（多管齐下，都无害）：
// A) tableWrapper 上加 will-change:transform —— 强制提升为独立合成层，
//    合成器会为其单独建 layer，hit-test 按层矩形走（绕过 buggy 路径）。
// B) 或给 table 加 transform:translateZ(0)。
// 先在运行时验证 A/B 是否有效：
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(800)
const buf = fs.readFileSync(DOC)
const form = new FormData()
form.append('file', new Blob([buf]), 'contract.docx')
const r = await fetch(BASE + '/api/doc/open', { method: 'POST', body: form })
const j = await r.json()
await p.evaluate(d => window.__setDocForTest(d), j.document)
await p.waitForTimeout(3500)
await p.evaluate(() => { [...document.querySelectorAll('.ProseMirror td')][2].scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(1200)
const test = async (name, apply) => {
  await p.evaluate(apply)
  await p.waitForTimeout(500)
  await p.evaluate(() => { window.__e = []; window.addEventListener('pointerdown', () => window.__e.push(1), { capture: true, passive: true }) })
  const box = await p.evaluate(() => { const r = [...document.querySelectorAll('.ProseMirror td')][2].getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(200)
  const ok = (await p.evaluate(() => window.__e.length)) > 0
  console.log(`${name}: ${ok ? '✅ ALIVE' : '❌ dead'}`)
  return ok
}
const clear = () => p.evaluate(() => {
  for (const w of document.querySelectorAll('.tableWrapper')) { w.style.willChange = ''; w.style.transform = '' }
  const t = document.querySelector('.ProseMirror table'); if (t) t.style.transform = ''
})
await clear()
await test('A wrapper will-change:transform', () => { for (const w of document.querySelectorAll('.tableWrapper')) w.style.willChange = 'transform' })
await clear()
await test('B wrapper translateZ(0)', () => { for (const w of document.querySelectorAll('.tableWrapper')) w.style.transform = 'translateZ(0)' })
await clear()
await test('C table translateZ(0)', () => { const t = document.querySelector('.ProseMirror table'); if (t) t.style.transform = 'translateZ(0)' })
await clear()
await test('D wrapper contain:layout', () => { for (const w of document.querySelectorAll('.tableWrapper')) w.style.contain = 'layout' })
await clear()
await b.close()
