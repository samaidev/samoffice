// 矛盾！verify13 里 white-space:normal ALIVE，但这次覆盖 pre-wrap/break-spaces
// 都 DEAD，而且 verify13 的 line-height 修改也是 ALIVE —— 共同点：它们的值
// 【改变了布局结果】（normal 折叠空格 → 行数变 / 1.2 行高变）。
// 而同值覆盖（pre-wrap→pre-wrap）不改变布局 → DEAD。
// verify14 还原后 DEAD —— 一致：bug 随「当前布局状态」。
// ★★★★★ 全部证据汇聚：bug = 【特定布局状态】下合成器 hit-test 缓存损坏。
// 改布局可短暂修复，回到问题布局 bug 复现。这是 Chromium 的
// "large contenteditable + pre-wrap + table + scroll" hit-test 损坏。
// 我们无法改 Chromium —— 但可以改变我们的布局使其脱离 bug！
// 嫌疑布局特征：pre-wrap（保留空格不换行）→ 表格前段落行宽超表格宽？
// 试官方的绕法：给 .ProseMirror 加 contain: layout / 或 content-visibility。
// 以及表格 wrapper 加 break-inside:avoid。
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
  await p.waitForTimeout(400)
  await p.evaluate(() => { window.__e = []; window.addEventListener('pointerdown', () => window.__e.push(1), { capture: true, passive: true }) })
  const box = await p.evaluate(() => { const r = [...document.querySelectorAll('.ProseMirror td')][2].getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, vis: r.y > 0 && r.y < 880 } })
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(200)
  console.log(`${name}:`, (await p.evaluate(() => window.__e.length)) > 0 ? 'ALIVE ✅' : 'DEAD')
}
await test('contain:layout', '.ProseMirror { contain: layout !important }')
await test('contain:content', '.ProseMirror { contain: content !important }')
await test('contain:paint', '.ProseMirror { contain: paint !important }')
await test('content-visibility', '.ProseMirror { content-visibility: auto !important; contain-intrinsic-size: auto 500px }')
await test('wrapper break-inside', '.ProseMirror .tableWrapper { break-inside: avoid !important }')
await test('无contain对照', '')
await b.close()
