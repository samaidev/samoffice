// 关键数据：pos 5174 的 DOM（"M"）在 docOffsetTop=10108 —— 但点击后
// 页面滚到 16142（参考文献页）—— 【不是滚到光标处】！16142 距 10108
// 差 6034 —— 完全无关的内容。这不是「滚到光标」而是【别的机制】。
// ★★★ 16142 + 视口中心 = 参考文献标题 —— 也就是【文档末尾附近】。
// 什么会把页面滚到末尾？—— 我们的 applySel 补刀 60ms 后 setSelection+
// focus —— 若 PM 的 domObserver 在 mouseup 后 flush 时把 selection
// 误同步（PM 从 DOM selection 读取到「文档末尾」的 caret —— 
// 前面 r27 的 anchor=P 末段落现象！）—— 但 PM selection.from=5174 正确
// —— PM 没动 —— 【滚动】是浏览器原生：DOM selection 的 range 若在
// 文档末尾的节点上 → 浏览器 focus/caret 跟随 → scrollIntoView。
// ◆ t9 显示点击后 100ms anchor="#text"（"M" td[8] 内文本）—— 
// 但那是【单点】场景。连续点击场景的 anchor 可能是末段落！
// 验证连续点击场景的 anchor 最终态：
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
await p.evaluate(() => { document.querySelector('.ProseMirror table').scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(1500)
let box = await p.evaluate(() => { const tds = [...document.querySelectorAll('td')]; const r = tds[6].getBoundingClientRect(); return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.5 } })
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(800)
// anchor 采样（覆盖点击后 1.5s，每 100ms）
await p.evaluate(() => {
  window.__anchors = []
  const iv = setInterval(() => {
    const a = window.getSelection()?.anchorNode
    window.__anchors.push(Math.round(performance.now()) + ':' + (a?.nodeName || '?') + ':' + (a?.textContent || '').slice(0, 6) + ':' + document.querySelector('.overflow-auto').scrollTop)
  }, 100)
  setTimeout(() => clearInterval(iv), 2000)
})
box = await p.evaluate(() => { const tds = [...document.querySelectorAll('td')]; const r = tds[8].getBoundingClientRect(); return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.5 } })
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(1800)
const seq = await p.evaluate(() => [...window.__anchors])
console.log('anchor 序列:')
for (const s of seq.slice(0, 14)) console.log(' ', s)
await b.close()
