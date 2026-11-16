// style 重算不修复。但「!important 覆盖」能修复 —— 区别：!important 会
// 改变匹配到的 declaration 顺序 → 层叠内容变化 → Layer 重建。
// 试试「真正会触发 layer/paint 失效」的操作：opacity 微调 / backface /
// position 改变。且这些操作要发生在「.ProseMirror 类规则上」。
// 等等 —— 更简单的思路！no-class ALIVE 说明：**不带 .ProseMirror 类的
// 元素没问题**。那把 CSS 里 .ProseMirror 的 white-space:pre-wrap 等
// 挪到 pm-host 上（或直接改 PM dom 的类名 SamPM）不就绕开了？
// 但 CSS 依赖 .ProseMirror 的规则海量（p/h1/h2/table…）。换个角度：
// **问题组合 = .ProseMirror 类 + 大文档**。逐步删类内容找最小触发对。
// 用二分：注入 style 让 .ProseMirror 只保留部分规则：
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1000)
const buf = fs.readFileSync(DOC)
const form = new FormData()
form.append('file', new Blob([buf]), 'contract.docx')
const r = await fetch(BASE + '/api/doc/open', { method: 'POST', body: form })
const j = await r.json()
await p.evaluate(d => window.__setDocForTest(d), j.document)
await p.waitForTimeout(4000)
await p.evaluate(() => { [...document.querySelectorAll('.ProseMirror td')][2].scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(1000)
const test = async (name, css) => {
  const box = await p.evaluate((css) => {
    const st = document.getElementById('tprobe-style') || (() => { const s = document.createElement('style'); s.id = 'tprobe-style'; document.head.appendChild(s); return s })()
    st.textContent = css
    window.__e = []
    window.addEventListener('pointerdown', () => window.__e.push(1), { capture: true, passive: true })
    const r = [...document.querySelectorAll('.ProseMirror td')][2].getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  }, css)
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(150)
  console.log(`${name}:`, (await p.evaluate(() => window.__e.length)) > 0 ? 'ALIVE ✅' : 'DEAD')
}
// 基础规则逐项关（白名单法：只关一项，其余保留）
await test('仅关 white-space', '.ProseMirror { white-space: normal !important }')
await test('仅关 font-family', '.ProseMirror { font-family: serif !important }')
await test('仅关 line-height', '.ProseMirror { line-height: 1.2 !important }')
await test('仅关 min-height', '.ProseMirror { min-height: 0 !important }')
await test('仅加 position:relative', '.ProseMirror { position: relative !important }')
await test('仅加 will-change', '.ProseMirror { will-change: transform !important }')
await b.close()
