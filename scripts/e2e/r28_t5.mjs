// 场景A 首次点击 sel 变了（5150）—— 但要验证 5150 是否在格内（目标格附近）
// 而不是文档末尾。场景B 滚动跳变 6484 —— 严重！sel 不变但页面跳走。
// 6484 跳变 = PM scrollIntoView 把表格所在页滚到视口 —— 点击格后
// PM 把 selection 设在 5150（若在格内）→ 但「点击格在视口中央」
// 不该滚动 —— 除非 PM 认为光标在别处（比如文档末尾）→ 滚过去 → 
// 这正是用户说的「页面位置移动无法定位」！
// 场景B 的 sel 没变（5150）—— 5150 是场景A 留下的 —— B 点击后
// 光标仍在 5150 但页面跳走 6484 —— 5150 的位置在很远处 → PM 
// scrollIntoView 找 5150？不对 —— A 点击后已经 5150，B 点击没生效
//（sel 不变）却触发滚动 —— B 的点击走 PM 原生 → posAtCoords 失败
//（死区）→ 但 PM 还是处理了 mousedown → caret 5150 → scrollIntoView
// → 表格页滚入视口（6484 跳变把文档滚到 5150 附近）。
// ★ 核心问题：场景A 的 5150 到底在不在格内？验证：
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
// 表格滚动到中央
await p.evaluate(() => { document.querySelector('.ProseMirror table').scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(1200)
// 点击 td[6]
const box = await p.evaluate(() => { const tds = [...document.querySelectorAll('td')]; const td = tds[6] || tds[0]; const r = td.getBoundingClientRect(); return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.5 } })
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(900)
const st = await p.evaluate(() => {
  const v = window.__pmView
  const sel = v.state.selection
  const $p = v.state.doc.resolve(sel.from)
  const chain = []
  for (let d = $p.depth; d > 0; d--) chain.push($p.node(d).type.name)
  const td6 = [...document.querySelectorAll('td')][6]
  return {
    from: sel.from,
    depthChain: chain.join('>'),
    parentText: $p.parent.textContent.slice(0, 15),
    td6Text: td6?.textContent?.slice(0, 15),
    match: $p.parent.textContent.slice(0, 15) === (td6?.textContent || '').slice(0, 15),
    scrollNow: document.querySelector('.overflow-auto').scrollTop,
  }
})
console.log('首次点击后光标:', JSON.stringify(st, null, 1))
await b.close()
