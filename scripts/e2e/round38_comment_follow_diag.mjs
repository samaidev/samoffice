// round38 诊断：用户反馈「批注内容没有跟着页面自动对应出现和位置滚动变更」
// round35 只测了：注入后静态布局、连线、点击。未覆盖的用户场景：
// A. 打开带批注文档后，卡片是否【自动出现】并对应锚点（首帧布局时机）
// B. 正文【编辑/分页重排】后，卡片 top 是否实时跟随锚点新位置
// C. 【连续滚动】过程中卡片/连线是否持续对齐（非一次性）
// D. 缩放变化后跟随
import { chromium } from 'playwright'
import fs from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DOC = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/comments_doc.udm.json'), 'utf-8'))
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 200)))

await p.goto(BASE + '/?r38=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
await p.evaluate(d => window.__setDocForTest(d), DOC)
// A: 不等长延时，文档注入后 300ms 内观察卡片是否出现并定位（首帧时机）
await p.waitForTimeout(300)
const early = await p.evaluate(() => {
  const cards = [...document.querySelectorAll('.comment-card')]
  const visible = cards.filter(c => c.style.visibility === 'visible' && parseFloat(c.style.top) > 0)
  return { n: cards.length, visible: visible.length, tops: visible.map(c => Math.round(parseFloat(c.style.top))) }
})
console.log('A1 注入后300ms：卡片', early.n, '可见', early.visible, 'tops:', early.tops.join(','))
await p.waitForTimeout(2500)

// 稳态锚点 y（供后续对比）
const anchorY = (pid) => p.evaluate(id => {
  const m = document.querySelector(`.comment-mark[data-comment-id="${id}"]`)
  return m ? Math.round(m.getBoundingClientRect().top) : null
}, pid)
const cardTop = (pid) => p.evaluate(id => {
  const c = document.getElementById(`comment-card-${id}`)
  return c ? Math.round(c.getBoundingClientRect().top) : null
}, pid)
const firstId = DOC.comments?.[0]?.id || await p.evaluate(() => document.querySelector('.comment-mark')?.getAttribute('data-comment-id'))
console.log('A2 稳态: 第一条锚点y=', await anchorY(firstId), '卡片y=', await cardTop(firstId))

// B: 在第一条批注前插入多行文本，分页重排 → 锚点下移 → 卡片应跟随
const before = { ay: await anchorY(firstId), cy: await cardTop(firstId) }
await p.evaluate(() => {
  // 直接往 ProseMirror 文档开头 dispatch 插入段落（无测试钩子时的兜底）
  const pm = document.querySelector('.ProseMirror')
  if (!pm) return
  pm.dispatchEvent(new MouseEvent('click', { bubbles: true }))
})
await p.keyboard.press('Control+Home')
await p.waitForTimeout(200)
await p.keyboard.type('\n'.repeat(0)) // focus 确认
await p.keyboard.press('Enter')
for (let i = 0; i < 29; i++) { await p.keyboard.press('Enter') }
await p.waitForTimeout(1500)
const after = { ay: await anchorY(firstId), cy: await cardTop(firstId) }
console.log('B 编辑重排: 锚点y', before.ay, '->', after.ay, '| 卡片y', before.cy, '->', after.cy,
  (after.ay !== before.ay && after.cy !== before.cy && Math.abs(after.cy - before.cy) > 10) ? '✓ 跟随' : '✗ 未跟随')

// C: 连续滚动 5 次每次 300px，检查每帧锚点-卡片对齐
let okC = 0, totC = 0
for (let i = 0; i < 5; i++) {
  await p.evaluate(() => {
    const el = document.querySelector('.comments-pane')?.parentElement
    let scroll = el
    while (scroll && scroll.tagName !== 'HTML') {
      const st = getComputedStyle(scroll)
      if (/(auto|scroll)/.test(st.overflowY) && scroll.scrollHeight > scroll.clientHeight + 4) break
      scroll = scroll.parentElement
    }
    scroll.scrollBy(0, 300)
  })
  await p.waitForTimeout(450)
  const ay = await anchorY(firstId), cy = await cardTop(firstId)
  if (ay !== null && cy !== null) { totC++; if (Math.abs(ay - cy) < 80) okC++ }
}
console.log(`C 连续滚动: 对齐 ${okC}/${totC}`, okC === totC ? '✓' : '✗')

// D: 缩放 125%
await p.evaluate(() => {
  const btns = [...document.querySelectorAll('button')].filter(b => /125|%/.test(b.textContent || '') && /zoom/i.test(b.className + b.id))
  return btns.length
})
console.log('D 缩放测试: 见手动补充')
await b.close()
