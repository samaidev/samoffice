// 场景B 代理仍 0 —— onFirst 触发了但 scheduleSync 没建层？
// 或者真实文档流程里 effect 根本没跑（__setDocForTest 后 DocumentEditor
// 重挂载？__samTableProxyMgr 窗口级标记在重挂载 cleanup 后被置 false
// —— 但新实例的 onFirst 需要 pointerdown —— 场景B 的首次点击是 A 里
// 的 mouse.click（pointerdown 应触发了 onFirst）……
// ★ 排查：onFirst 是否触发（window 上的 __samTableProxyMgr 标记）
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
// 检查管理器标记与 effect 生命周期
const st = await p.evaluate(() => ({
  mgrFlag: window.__samTableProxyMgr === true ? 'armed/used' : String(window.__samTableProxyMgr),
  pmWrappers: document.querySelectorAll('.ProseMirror .tableWrapper').length,
  allWrappers: document.querySelectorAll('.tableWrapper').length,
}))
console.log('管理器状态:', JSON.stringify(st))
// 派发真实 pointerdown 到正文（激活 onFirst）
const pb = await p.evaluate(() => { const r = document.querySelector('.ProseMirror p').getBoundingClientRect(); return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.5 } })
await p.mouse.click(pb.x, pb.y)
await p.waitForTimeout(600)
const st2 = await p.evaluate(() => ({ mgrFlag: String(window.__samTableProxyMgr) }))
console.log('点击后标记:', JSON.stringify(st2))
await p.waitForTimeout(4500)
const st3 = await p.evaluate(() => ({ proxy: document.querySelectorAll('.pm-table-clickproxy').length }))
console.log('等待后代理:', JSON.stringify(st3))
await b.close()
