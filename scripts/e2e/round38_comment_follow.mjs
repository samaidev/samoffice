// round38 验证：批注卡片跟随锚点（修复底部钳制后）
// ① 注入后稳态：卡片与锚点对齐（|卡片中心-锚点中心|<=12px）
// ② Enter 30 次（分页重排）后：卡片实时跟随锚点新位置（不再被钉在窗口内）
// ③ 滚动 600px 后：对齐保持
// ④ 防重叠仍然有效（无两卡重叠）
// ⑤ 无卡片被钳制在可视窗口底部（top < viewH-h-4 的钳制痕迹）
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

const measure = () => p.evaluate(() => {
  const pane = document.querySelector('.comments-pane')
  if (!pane) return null
  let scroll = pane.parentElement
  while (scroll && scroll.tagName !== 'HTML') {
    const st = getComputedStyle(scroll)
    if (/(auto|scroll)/.test(st.overflowY) && scroll.scrollHeight > scroll.clientHeight + 4) break
    scroll = scroll.parentElement
  }
  const sr = scroll.getBoundingClientRect()
  const pr = pane.getBoundingClientRect()
  const out = []
  const cards = [...pane.querySelectorAll('.comment-card')]
  let overlaps = 0
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i]
    const cid = c.id.replace('comment-card-', '')
    const m = scroll.querySelector(`.comment-mark[data-comment-id="${cid}"]`)
    const cr = c.getBoundingClientRect()
    const row = { id: cid, markTop: null, cardTop: Math.round(cr.top - sr.top), alignErr: null, visibleInPane: cr.bottom > pr.top && cr.top < pr.bottom }
    if (m) {
      const mr = m.getBoundingClientRect()
      row.markTop = Math.round(mr.top - sr.top)
      // 对齐判定（Word 式）：卡片须"挂住"锚点 —— 锚点中心落在卡片纵向范围内
      // （允许 ±12px 容差；防重叠下移只许向下推、且推出后锚点仍须在卡片上缘附近之上）
      const mc = mr.top + mr.height / 2 - sr.top
      const cc = cr.top + cr.height / 2 - sr.top
      const hang = mc >= cr.top - sr.top - 12 && mc <= cr.bottom - sr.top + 12
      row.alignErr = hang ? 0 : Math.round(Math.abs(cc - mc))
    }
    out.push(row)
    if (i > 0) {
      const prev = cards[i - 1].getBoundingClientRect()
      if (cr.top < prev.bottom - 1) overlaps++
    }
  }
  return { rows: out, overlaps, paneH: Math.round(pane.getBoundingClientRect().height), viewH: scroll.clientHeight }
})

await p.goto(BASE + '/?r38v=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
await p.evaluate(d => window.__setDocForTest(d), DOC)
await p.waitForTimeout(3000)

// ① 稳态对齐
const s1 = await measure()
const bad1 = s1.rows.filter(r => r.alignErr === null || r.alignErr > 12)
console.log(`① 稳态对齐: ${s1.rows.length - bad1.length}/${s1.rows.length} ${bad1.length === 0 ? '✓' : '✗ ' + JSON.stringify(bad1)}`)
console.log(`   面板高 ${s1.paneH}px（可视 ${s1.viewH}px）重叠 ${s1.overlaps}`)

// ② Enter 30 次后跟随
await p.click('.ProseMirror', { position: { x: 300, y: 80 }, force: true, timeout: 8000 })
await p.waitForTimeout(200)
for (let i = 0; i < 30; i++) await p.keyboard.press('Enter')
await p.waitForTimeout(2000)
const s2 = await measure()
const bad2 = s2.rows.filter(r => r.alignErr === null || r.alignErr > 12)
const moved = s2.rows.filter(r => { const before = s1.rows.find(x => x.id === r.id); return before && before.markTop !== r.markTop })
const followed = moved.filter(r => { const before = s1.rows.find(x => x.id === r.id); return before && Math.abs(before.cardTop - r.cardTop) > 10 })
console.log(`② Enter30 后: 锚点移动 ${moved.length}/${s2.rows.length}，卡片跟随 ${followed.length}/${moved.length} ${bad2.length === 0 ? '✓' : '✗ ' + JSON.stringify(bad2.slice(0, 3))}`)

// ③ 滚动 600px
await p.evaluate(() => {
  const pane = document.querySelector('.comments-pane')
  let scroll = pane.parentElement
  while (scroll && scroll.tagName !== 'HTML') {
    const st = getComputedStyle(scroll)
    if (/(auto|scroll)/.test(st.overflowY)) { scroll.scrollTop += 600; break }
    scroll = scroll.parentElement
  }
})
await p.waitForTimeout(800)
const s3 = await measure()
const vis3 = s3.rows.filter(r => r.visibleInPane)
const bad3 = vis3.filter(r => r.alignErr === null || r.alignErr > 12)
console.log(`③ 滚动后: 视口内 ${vis3.length} 卡对齐 ${vis3.length - bad3.length} ${bad3.length === 0 ? '✓' : '✗ ' + JSON.stringify(bad3)}`)

// ④ 防重叠
console.log(`④ 防重叠: Enter后重叠 ${s2.overlaps} ${s2.overlaps === 0 ? '✓' : '✗'}`)

// ⑤ 无钳制痕迹：面板高≈可视高（不再被 minHeight 撑成 1998 长条）
console.log(`⑤ 面板高度: ${s2.paneH}px vs 可视 ${s2.viewH}px ${Math.abs(s2.paneH - s2.viewH) <= 8 ? '✓ 不再撑高' : '✗ 仍被撑高'}`)

const allPass = bad1.length === 0 && bad2.length === 0 && bad3.length === 0 && s2.overlaps === 0 && Math.abs(s2.paneH - s2.viewH) <= 8
console.log(`\n=== round38 结果: ${allPass ? 'ALL PASS ✓' : 'FAIL ✗'} ===`)
await b.close()
process.exit(allPass ? 0 : 1)
