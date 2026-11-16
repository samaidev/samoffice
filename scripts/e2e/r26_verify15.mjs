// 还原后 bug 回来了！（覆盖时 ALIVE、还原后 DEAD）
// → 死区绑定在「当前层叠状态」上：只要【现在】的 white-space 是 pre-wrap
// 就死。之前「仅关 line-height ALIVE」同理吗？—— line-height 改变时活的
// 是【那个时刻】，还原后可能也死。
// 真相呼之欲出：**white-space: pre-wrap + 高 contenteditable = Chromium
// 合成器 hit-test bug 的触发条件**！
// 决定性实验：保持其它一切不变，只把 .ProseMirror 的 white-space 永久
// 改成 break-spaces（与 pre-wrap 行为几乎一致：保留空格+换行，差别仅
// 行尾空格是否悬挂）—— 如果永久 ALIVE，就是终极修复！
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
  await p.evaluate((css) => {
    const st = document.getElementById('tp') || (() => { const s = document.createElement('style'); s.id = 'tp'; document.head.appendChild(s); return s })()
    st.textContent = css
  }, css)
  await p.waitForTimeout(300)
  await p.evaluate(() => { window.__e = []; window.addEventListener('pointerdown', () => window.__e.push(1), { capture: true, passive: true }) })
  const box = await p.evaluate(() => { const r = [...document.querySelectorAll('.ProseMirror td')][2].getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(200)
  console.log(`${name}:`, (await p.evaluate(() => window.__e.length)) > 0 ? 'ALIVE ✅' : 'DEAD')
}
// 永久覆盖（不清除），多点击几个格子验证
await test('break-spaces', '.ProseMirror { white-space: break-spaces !important }')
await test('pre-wrap（对照）', '.ProseMirror { white-space: pre-wrap !important }')
await test('break-spaces 再测', '.ProseMirror { white-space: break-spaces !important }')
await b.close()
