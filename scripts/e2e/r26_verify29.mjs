// 终验：.ProseMirror { content-visibility: auto } 曾 ALIVE —— 验证分页/纸张
// 是否仍正常（分页引擎靠 offsetHeight，强制布局应返回真实值）。
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 100)))
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
// 基线分页状态
const before = await p.evaluate(() => ({
  papers: document.querySelectorAll('.pg-paper').length,
  pmH: window.__pmView.dom.scrollHeight,
}))
// 应用修复 CSS
await p.evaluate(() => {
  const st = document.createElement('style')
  st.id = 'r26fix'
  // 核心：content-visibility:auto 让 Chromium 对大文档走分块渲染路径，
  // 绕过损坏的整页 hit-test 缓存；contain-intrinsic-size 保住占位高度。
  st.textContent = `
    .ProseMirror { content-visibility: auto; contain-intrinsic-size: auto 500px; }
    .ProseMirror .tableWrapper { content-visibility: auto; contain-intrinsic-size: auto 100px 400px; }
  `
  document.head.appendChild(st)
})
await p.waitForTimeout(1200)
const after = await p.evaluate(() => ({
  papers: document.querySelectorAll('.pg-paper').length,
  pmH: window.__pmView.dom.scrollHeight,
}))
console.log('pagination before:', JSON.stringify(before), 'after:', JSON.stringify(after))
// 点击测试（多个格子）
await p.evaluate(() => { [...document.querySelectorAll('.ProseMirror td')][2].scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(800)
for (const idx of [2, 5]) {
  await p.evaluate(() => { window.__e = []; window.addEventListener('pointerdown', () => window.__e.push(1), { capture: true, passive: true }) })
  const box = await p.evaluate((i) => { const r = [...document.querySelectorAll('.ProseMirror td')][i].getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } }, idx)
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(250)
  const alive = (await p.evaluate(() => window.__e.length)) > 0
  const sel = await p.evaluate(() => window.__pmView.state.selection.from)
  console.log(`td[${idx}] click: ${alive ? 'ALIVE ✅' : 'DEAD'} selFrom=${sel}`)
  await p.keyboard.type('Q', { delay: 40 })
  await p.waitForTimeout(300)
  console.log('  text:', JSON.stringify(await p.evaluate((i) => [...document.querySelectorAll('.ProseMirror td')][i]?.textContent, idx)))
}
await b.close()
