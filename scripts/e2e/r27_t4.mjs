// addRange 记录 = [] —— 我们的同步代码【确实没跑】。
// mousedown 的延时回调整个执行了吗？dispatch setSelection 执行了
//（from=52 变了！）→ 回调跑了前半段 → 后半段（DOM sel 同步）静默失败。
// tdEl 查找用的 r/c：点击 td[0] 时 r=0,c=0。
// wrapper.querySelectorAll('tr')[0] —— wrapper 是 .tableWrapper！
// ★★★ 找到了：wrapper.querySelectorAll('td,th') —— 但注意
// ensureProxy 收到的 w 来自 pm.querySelectorAll('.tableWrapper') ——
// 是 wrapper 本身。querySelectorAll('tr') 应该有 2 行……
// 除非 —— 【r/c 与 dispatch 用的是变量遮蔽前的旧值】？
// 直接在页面里模拟同样代码验证 tdEl 查找：
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 150)))
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
await p.evaluate(() => window.__setDocForTest({ meta: { title: 't' }, blocks: [
  { type: 'p', inline: [{ content: '段落内容一' }] },
  { type: 'table', rows: [
    [{ inline: [{ content: 'A1' }] }, { inline: [{ content: 'B1' }] }],
    [{ inline: [{ content: 'A2' }] }, { inline: [{ content: 'B2' }] }],
  ] },
] }))
await p.waitForTimeout(2500)
const pb = await p.evaluate(() => { const r = document.querySelector('.ProseMirror p').getBoundingClientRect(); return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.5 } })
await p.mouse.click(pb.x, pb.y)
await p.waitForTimeout(600)
const box = await p.evaluate(() => { const r = document.querySelector('td').getBoundingClientRect(); return { x: r.x + r.width * 0.6, y: r.y + r.height * 0.5 } })
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(900)
// 模拟管理器同款查找（点击点 → tdEl → findText）
const sim = await p.evaluate((pt) => {
  const pm = window.__pmView.dom
  const w = pm.querySelector('.tableWrapper')
  const rows = w.querySelectorAll('tr')
  let hit = null
  rows.forEach((tr, r) => {
    if (hit) return
    tr.querySelectorAll('td,th').forEach((td, c) => {
      if (hit) return
      const rect = td.getBoundingClientRect()
      if (pt.x >= rect.left && pt.x <= rect.right && pt.y >= rect.top && pt.y <= rect.bottom) hit = { r, c }
    })
  })
  const tdEl = hit ? rows[hit.r]?.querySelectorAll('td,th')[hit.c] : null
  const findText = (el) => { for (const n of Array.from(el.childNodes)) { if (n.nodeType === 3) return n; const rr = findText(n); if (rr) return rr } return null }
  const tn = tdEl ? findText(tdEl) : null
  return { hit, tdElText: tdEl?.textContent, tnFound: !!tn, tnText: tn?.textContent }
}, box)
console.log('同款查找模拟:', JSON.stringify(sim))
await b.close()
