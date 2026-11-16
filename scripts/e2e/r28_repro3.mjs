// proxyExists:false —— 真实文档打开后管理器根本没建代理！
// r27 的 E2E 全绿是因为：__setDocForTest 前先点了正文（激活 onFirst）。
// 真实用户流程：打开文档直接点表格 —— onFirst 还没触发过（用户第一次
// pointerdown 就是点表格）—— 但 onFirst 是 document capture，点表格也
// 会触发 → 2s 后才建层 —— 用户第一次点击时没有代理，走 PM 原生
//（被分页装饰层拦截 → 死区 → 事件丢失 → 无光标！）。
// 但 repro 里我等了 5s + scrollIntoView + 又点击 —— 第二次点击时代理
// 应该在了…… 除非 onFirst 触发条件（pointerdown）在 Playwright
// mouse.click 里也派发 pointerdown —— 是。那 2s/4s 波次后应有代理。
// repro 的点击发生在 goto 后 ~8s —— onFirst 首次触发于【scrollIntoView
// 前？没有 pointerdown】—— 我的 scrollIntoView 是 evaluate（无鼠标事件）
// —— 唯一的 pointerdown 是最后那次 mouse.click —— 代理在其后 2s 才建
// —— 点击已错过！
// ★★★ 这就是用户场景：第一次点击表格 = 死区（无代理层）→ 无光标 →
// PM 收到 mousedown 后 caret 放到文档某处 → scrollIntoView 跳页！
// 验证 + 修复方向：代理层不能等「首次交互后 2s」—— 挂载期就建！
//（r26 时代的挂载期死层问题 —— 用 MessageChannel + 交互后重建可解）
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 150)))
p.setDefaultTimeout(30000)
await p.goto(BASE + '/?r=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
const buf = fs.readFileSync(DOC)
const form = new FormData()
form.append('file', new Blob([buf]), 'contract.docx')
const r = await fetch(BASE + '/api/doc/open', { method: 'POST', body: form })
const j = await r.json()
await p.evaluate(d => window.__setDocForTest(d), j.document)
await p.waitForTimeout(5000)
// 场景A：第一次点击直接点表格（用户场景）
const tbl = await p.evaluate(() => { const t = document.querySelector('.ProseMirror table'); t.scrollIntoView({ block: 'center' }); return true })
await p.waitForTimeout(1200)
const before = await p.evaluate(() => ({ top: document.querySelector('.overflow-auto').scrollTop, sel: window.__pmView.state.selection.from }))
const box = await p.evaluate(() => { const tds = [...document.querySelectorAll('td')]; const td = tds[6] || tds[0]; const r = td.getBoundingClientRect(); return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.5 } })
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(900)
const after = await p.evaluate(() => ({ top: document.querySelector('.overflow-auto').scrollTop, sel: window.__pmView.state.selection.from, proxy: document.querySelectorAll('.pm-table-clickproxy').length }))
console.log('场景A 首次点击即点表格:')
console.log('  滚动:', before.top, '→', after.top, Math.abs(after.top - before.top) > 50 ? '⚠️跳走' : '稳定')
console.log('  sel:', before.sel, '→', after.sel, after.sel !== before.sel ? '变了' : '❌死区')
// 场景B：等 5s（若 onFirst 被首次点击触发，代理应已建）再点
await p.waitForTimeout(4500)
const box2 = await p.evaluate(() => { const tds = [...document.querySelectorAll('td')]; const td = tds[6] || tds[0]; const r = td.getBoundingClientRect(); return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.5 } })
const before2 = await p.evaluate(() => ({ top: document.querySelector('.overflow-auto').scrollTop, sel: window.__pmView.state.selection.from }))
await p.mouse.click(box2.x, box2.y)
await p.waitForTimeout(900)
const after2 = await p.evaluate(() => ({ top: document.querySelector('.overflow-auto').scrollTop, sel: window.__pmView.state.selection.from, proxy: document.querySelectorAll('.pm-table-clickproxy').length }))
console.log('场景B 二次点击（代理应已建）:')
console.log('  代理数:', after2.proxy, after2.proxy > 0 ? '✓已建' : '❌仍无')
console.log('  sel:', before2.sel, '→', after2.sel, after2.sel !== before2.sel ? '✓进格' : '❌死区')
console.log('  滚动跳变:', after2.top - before2.top)
await b.close()
