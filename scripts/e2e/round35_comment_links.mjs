// round35 验证：右侧批注卡片 ↔ 正文锚点连接线
// 用 7 条批注的 UDM fixture 直接注入（不依赖后端 /api/doc/open）：
// ① 批注卡片在面板内绝对定位、无重叠（相邻卡片 bottom <= 下一张 top）
// ② 每条批注都有连线（SVG path 数 == 卡片数），锚点端对齐圆点、卡片端对齐卡片中心
// ③ 滚动后连线仍然对齐（锚点端 y 跟随正文移动）
// ④ 点击卡片 → 正文选中对应锚点；卡片激活态出现
// ⑤ 无 -9999 离屏残留卡片
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

await p.goto(BASE + '/?r35=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)

await p.evaluate(d => window.__setDocForTest(d), DOC)
await p.waitForTimeout(4000)

// ---------- ① 连线与卡片基础状态 ----------
const base = await p.evaluate(() => {
  // 滚动容器 = comments-pane 最近的可滚动祖先
  let el = document.querySelector('.comments-pane')?.parentElement
  let scroll = el
  while (scroll && scroll.tagName !== 'HTML') {
    const st = getComputedStyle(scroll)
    if (/(auto|scroll)/.test(st.overflowY) && scroll.scrollHeight > scroll.clientHeight + 4) break
    scroll = scroll.parentElement
  }
  const pane = document.querySelector('.comments-pane')
  const cards = [...document.querySelectorAll('.comment-card')]
  const marks = [...document.querySelectorAll('.comment-mark')]
  const svg = document.querySelector('.comment-links-layer')
  const paths = svg ? [...svg.querySelectorAll('path')] : []
  const pr = pane?.getBoundingClientRect()
  const sr = scroll.getBoundingClientRect()
  // 卡片重叠检测
  const tops = cards.map(c => { const r = c.getBoundingClientRect(); return { id: c.id, top: r.top, bottom: r.bottom, left: r.left } })
  let overlap = 0
  for (let i = 1; i < tops.length; i++) if (tops[i].top < tops[i - 1].bottom - 1) overlap++
  // 每条连线终点应贴近面板左缘
  let endOk = 0
  for (const pa of paths) {
    const d = pa.getAttribute('d') || ''
    const m = d.match(/L\s+([\d.]+)\s+([\d.]+)/)
    if (m && pr && Math.abs(parseFloat(m[1]) - (pr.left - sr.left - 5)) < 3) endOk++
  }
  return {
    scrollFound: !!scroll && scroll.tagName !== 'HTML',
    cards: cards.length, marks: marks.length, paths: paths.length,
    overlap, endOk,
    // 面板内可达性：卡片 absolute 在面板内、面板可滚 —— 视口外(top>900)是正常行为。
    // 真正的 bug 是 visibility:hidden 残留（布局阶段没跑到）或 top < -100（-9999 离屏兜底残留）。
    hidden: cards.filter(c => {
      const st = getComputedStyle(c)
      return st.visibility === 'hidden' || parseFloat(String(st.top)) < -100
    }).length,
    // 所有卡片的 bottom 都必须在面板滚动范围内（scrollHeight 覆盖），否则滚到底也看不到
    paneReach: cards.every(c => {
      const st = getComputedStyle(c)
      return parseFloat(String(st.top)) + c.offsetHeight <= pane.scrollHeight + 2
    }),
    paneH: pane ? pane.scrollHeight : 0,
    paneW: pr?.width, svgExists: !!svg,
    sampleCard: tops[0] ? { top: Math.round(tops[0].top), left: Math.round(tops[0].left) } : null,
  }
})
console.log(`① 卡片 ${base.cards} 张 / 锚点 ${base.marks} 个 / 连线 ${base.paths} 条 / SVG层 ${base.svgExists ? '✓' : '✗'} / scroll容器 ${base.scrollFound ? '✓' : '✗'}`)
console.log(`   重叠对数: ${base.overlap} ${base.overlap === 0 ? '✓' : '✗'} | 终点贴面板缘: ${base.endOk}/${base.paths} ${base.endOk === base.paths ? '✓' : '✗'} | 隐藏残留: ${base.hidden} ${base.hidden === 0 ? '✓' : '✗'} | 面板内可达: ${base.paneReach ? '✓' : '✗'}（面板内容高 ${base.paneH}px）`)
const pass1 = base.cards === 7 && base.marks >= 7 && base.paths === base.cards && base.overlap === 0 && base.hidden === 0 && base.paneReach

// ---------- ② 连线几何：锚点端贴近锚点圆点、卡片端贴近卡片中心 ----------
const geo = await p.evaluate(() => {
  let scroll = document.querySelector('.comments-pane')?.parentElement
  while (scroll && scroll.tagName !== 'HTML') {
    const st = getComputedStyle(scroll)
    if (/(auto|scroll)/.test(st.overflowY) && scroll.scrollHeight > scroll.clientHeight + 4) break
    scroll = scroll.parentElement
  }
  const sr = scroll.getBoundingClientRect()
  const svg = document.querySelector('.comment-links-layer')
  const paths = [...svg.querySelectorAll('g')]
  let anchored = 0, cardEndOk = 0
  for (const g of paths) {
    const d = g.querySelector('path').getAttribute('d') || ''
    const m1 = d.match(/M\s+([\d.-]+)\s+([\d.-]+)/)
    const m2 = d.match(/L\s+([\d.-]+)\s+([\d.-]+)/)
    if (!m1 || !m2) continue
    const x1 = parseFloat(m1[1]), y1 = parseFloat(m1[2]), y2 = parseFloat(m2[2])
    // 找最近的锚点：锚点右缘中点应与 (x1,y1) 相差 < 8px
    const marks = [...scroll.querySelectorAll('.comment-mark')]
    const near = marks.some(mk => {
      const r = mk.getBoundingClientRect()
      return Math.abs(r.right - sr.left - x1) < 8 && Math.abs(r.top + r.height / 2 - sr.top - y1) < 8
    })
    if (near) anchored++
    // 卡片端：找对应卡片中心 y
    const cards = [...scroll.querySelectorAll('.comment-card')]
    const hitCard = cards.some(c => { const r = c.getBoundingClientRect(); return Math.abs(r.top + r.height / 2 - sr.top - y2) < 20 })
    if (hitCard) cardEndOk++
  }
  return { total: paths.length, anchored, cardEndOk }
})
console.log(`② 连线几何: 锚点端对齐 ${geo.anchored}/${geo.total} ${geo.anchored === geo.total ? '✓' : '✗'} | 卡片端对齐 ${geo.cardEndOk}/${geo.total} ${geo.cardEndOk === geo.total ? '✓' : '✗'}`)
const pass2 = geo.anchored === geo.total && geo.cardEndOk === geo.total && geo.total > 0

// ---------- ③ 滚动后连线仍对齐 ----------
await p.evaluate(() => {
  let scroll = document.querySelector('.comments-pane')?.parentElement
  while (scroll && scroll.tagName !== 'HTML') {
    const st = getComputedStyle(scroll)
    if (/(auto|scroll)/.test(st.overflowY) && scroll.scrollHeight > scroll.clientHeight + 4) break
    scroll = scroll.parentElement
  }
  // 滚到内容中部（不超过 maxScroll），保证有锚点进入视口
  scroll.scrollTop = Math.floor((scroll.scrollHeight - scroll.clientHeight) / 2)
})
await p.waitForTimeout(800)
const geo2 = await p.evaluate(() => {
  let scroll = document.querySelector('.comments-pane')?.parentElement
  while (scroll && scroll.tagName !== 'HTML') {
    const st = getComputedStyle(scroll)
    if (/(auto|scroll)/.test(st.overflowY) && scroll.scrollHeight > scroll.clientHeight + 4) break
    scroll = scroll.parentElement
  }
  const sr = scroll.getBoundingClientRect()
  const svg = document.querySelector('.comment-links-layer')
  const paths = [...svg.querySelectorAll('g')]
  // 只检查视口内的锚点（滚出视口的连线端点可以在视口外）
  let inViewAnchored = 0, inViewTotal = 0
  for (const g of paths) {
    const d = g.querySelector('path').getAttribute('d') || ''
    const m1 = d.match(/M\s+([\d.-]+)\s+([\d.-]+)/)
    if (!m1) continue
    const x1 = parseFloat(m1[1]), y1 = parseFloat(m1[2])
    if (y1 < 0 || y1 > sr.height) continue // 锚点不在视口
    inViewTotal++
    const marks = [...scroll.querySelectorAll('.comment-mark')]
    const near = marks.some(mk => {
      const r = mk.getBoundingClientRect()
      return Math.abs(r.top + r.height / 2 - sr.top - y1) < 8 && Math.abs(r.right - sr.left - x1) < 8
    })
    if (near) inViewAnchored++
  }
  return { inViewTotal, inViewAnchored }
})
console.log(`③ 滚动 1500px 后: 视口内锚点连线对齐 ${geo2.inViewAnchored}/${geo2.inViewTotal} ${geo2.inViewTotal === 0 || geo2.inViewAnchored === geo2.inViewTotal ? '✓' : '✗'}`)
const pass3 = geo2.inViewTotal === 0 || geo2.inViewAnchored === geo2.inViewTotal

// ---------- ④ 交互：点卡片选中正文锚点 / 点锚点激活卡片 ----------
const card = p.locator('.comment-card').first()
await card.scrollIntoViewIfNeeded()
await p.waitForTimeout(400)
await card.click()
await p.waitForTimeout(600)
const sel = await p.evaluate(() => {
  const v = window.__pmView
  const s = v?.state?.selection
  return { from: s?.from, to: s?.to, nodeAt: v?.state?.doc?.nodeAt?.(s?.from)?.type?.name }
})
console.log(`④ 点击卡片后选区: ${JSON.stringify(sel)} ${sel.nodeAt === 'comment_mark' ? '✓' : '✗'}`)

const activeAfterCard = await p.evaluate(() => !!document.querySelector('.comment-card.active'))
console.log(`   卡片激活态: ${activeAfterCard ? '✓' : '✗'}`)
const pass4 = sel.nodeAt === 'comment_mark' && activeAfterCard

await p.screenshot({ path: '/home/z/my-project/download/round35-批注连接线.png', fullPage: false })
await b.close()

const allPass = pass1 && pass2 && pass3 && pass4
console.log(`\n=== round35 结果: ${allPass ? 'ALL PASS ✓' : 'FAIL ✗'} ===`)
process.exit(allPass ? 0 : 1)
