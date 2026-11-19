// round39 验证：三个用户反馈
// ① 批注内容自动跟随正文滚动，连线/卡片不得跨页（限制在锚点所在纸页内）
// ② 表格左上角全选按钮点击有效（CellSelection 全选）
// ③ 全选按钮按住拖动可移动表格位置
import { chromium } from 'playwright'
import fs from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 200)))

// ---- 测试文档：多页（长正文）+ 7 条批注（含页顶/页尾锚点）+ 1 个表格 ----
const para = (text, commentId) => commentId
  ? { type: 'paragraph', inline: [{ type: 'text', content: text, commentId }] }
  : { type: 'paragraph', inline: [{ type: 'text', content: text }] }
const blocks = [
  { type: 'heading', level: 1, inline: [{ type: 'text', content: 'round39 测试文档：批注跨页 + 表格手柄', commentId: 'c1' }] },
]
// 足够长的正文把后续批注推到第 2、3 页
for (let i = 1; i <= 12; i++) {
  blocks.push(para(`第${i}段：这是用于撑页数的长正文。合同能源管理模式下能源管理公司和用户的效益分配研究涉及多期动态合约的激励设计，现有研究多聚焦于单期合约，对多期动态合约下的效益分配机制探讨不足。本段文字用于将后续批注锚点分布到不同纸页上，验证批注卡片与连线是否被限制在锚点所在页内。${'重复填充文本内容用于分页测试。'.repeat(4)}`))
}
blocks.push(para('这一段的批注锚点在第 2 页中部。参与约束要求 EMCO 的确定性等价收入不低于保留效用，激励相容约束则要求最优努力水平可被诱导。', 'c2'))
for (let i = 13; i <= 18; i++) {
  blocks.push(para(`第${i}段：继续填充正文以产生第三页。风险分担系数与努力成本系数共同决定效益分配比例，风险规避度越高最优分享比例越低。${'多期动态合约下的效益分配机制探讨。'.repeat(3)}`))
}
blocks.push(para('页尾锚点测试：此段贴近某页底部，其批注卡片必须仍在本页内显示（或本页放不下时隐藏），不得溢出到下一页。', 'c3'))
for (let i = 19; i <= 22; i++) {
  blocks.push(para(`第${i}段：尾部填充。结论部分应当分点总结研究贡献、局限性与后续工作方向。${'结论性填充文字。'.repeat(3)}`))
}
blocks.push(para('表格前的段落。', 'c4'))
// 表格：3 行 3 列
const cell = (t, isHeader) => ({ inline: [{ type: 'text', content: t }], isHeader: !!isHeader, colSpan: 1, rowSpan: 1 })
blocks.push({
  type: 'table',
  rows: [
    [cell('列A', true), cell('列B', true), cell('列C', true)],
    [cell('数据1', false), cell('数据2', false), cell('数据3', false)],
    [cell('数据4', false), cell('数据5', false), cell('数据6', false)],
  ],
})
blocks.push(para('表格后的段落一。', 'c5'))
blocks.push(para('表格后的段落二。', 'c6'))
blocks.push(para('文档末尾段落。', 'c7'))

const DOC = {
  meta: { title: 'round39' },
  comments: [
    { id: 'c1', author: '审稿人A', content: '标题批注：建议突出研究对象与方法。' },
    { id: 'c2', author: '审稿人B', content: '中部批注：公式推导建议补充中间步骤。' },
    { id: 'c3', author: '审稿人C', content: '页尾批注：验证卡片不跨页。这段文字较长是为了让卡片高度足够大，从而在页尾锚点处触发页带约束。卡片必须限制在本页内，放不下则隐藏，绝不溢出。' },
    { id: 'c4', author: '审稿人D', content: '表前批注：表格应补充数据来源。' },
    { id: 'c5', author: '审稿人E', content: '表后批注一。' },
    { id: 'c6', author: '审稿人F', content: '表后批注二。' },
    { id: 'c7', author: '审稿人G', content: '末尾批注。' },
  ],
  blocks,
}

await p.goto(BASE + '/?r39=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
await p.evaluate(d => window.__setDocForTest(d), DOC)
await p.waitForTimeout(3500)

// ================= ① 批注卡片/连线不跨页 =================
const r1 = await p.evaluate(() => {
  const pane = document.querySelector('.comments-pane')
  let scroll = pane?.parentElement
  while (scroll && scroll.tagName !== 'HTML') {
    const st = getComputedStyle(scroll)
    if (/(auto|scroll)/.test(st.overflowY) && scroll.scrollHeight > scroll.clientHeight + 4) break
    scroll = scroll.parentElement
  }
  if (!pane || !scroll) return null
  const pr = pane.getBoundingClientRect()
  const papers = [...scroll.querySelectorAll('.pg-paper')].map(el => el.getBoundingClientRect())
  papers.sort((a, b) => a.top - b.top)
  const rows = []
  const cards = [...pane.querySelectorAll('.comment-card')]
  for (const c of cards) {
    const cid = c.id.replace('comment-card-', '')
    const m = scroll.querySelector(`.comment-mark[data-comment-id="${cid}"]`)
    const cr = c.getBoundingClientRect()
    const hidden = cr.top < -5000
    let anchorPage = -1
    if (m) {
      const mr = m.getBoundingClientRect()
      for (let i = 0; i < papers.length; i++) {
        if (mr.top >= papers[i].top - 1 && mr.top <= papers[i].bottom + 1) { anchorPage = i; break }
      }
    }
    // 卡片所跨的页（可见时）
    let cardPages = []
    if (!hidden) {
      for (let i = 0; i < papers.length; i++) {
        if (cr.bottom > papers[i].top + 2 && cr.top < papers[i].bottom - 2) cardPages.push(i)
      }
    }
    rows.push({ id: cid, hidden, anchorPage, cardPages: [...new Set(cardPages)] })
  }
  // 连线：每条 path 两端 y 是否在同一纸页内
  const paths = [...scroll.querySelectorAll('.comment-links-layer path')]
  const linkRows = []
  for (const pathEl of paths) {
    const d = pathEl.getAttribute('d') || ''
    const nums = d.match(/-?[\d.]+/g)?.map(Number) || []
    if (nums.length < 4) continue
    const y1 = nums[1], y2 = nums[3]
    // SVG 层 sticky 在滚动容器视口顶 —— svg 坐标系相对 svg 左上角。
    // 绝对视口 y = svgRect.top + y（无需再加 scrollTop：sticky 层不随滚动平移）。
    const svg = pathEl.closest('svg').getBoundingClientRect()
    const absY1 = svg.top + y1
    const absY2 = svg.top + y2
    let pg1 = -1, pg2 = -1
    for (let i = 0; i < papers.length; i++) {
      if (absY1 >= papers[i].top && absY1 <= papers[i].bottom) pg1 = i
      if (absY2 >= papers[i].top && absY2 <= papers[i].bottom) pg2 = i
    }
    linkRows.push({ pg1, pg2, cross: pg1 !== pg2 && pg1 >= 0 && pg2 >= 0, out: pg1 < 0 || pg2 < 0 })
  }
  return { rows, linkRows, paperCount: papers.length }
})
const visibleCards = r1.rows.filter(r => !r.hidden)
const crossPageCards = visibleCards.filter(r => r.cardPages.length > 1 || (r.cardPages.length === 1 && r.anchorPage >= 0 && r.cardPages[0] !== r.anchorPage))
const noPage = visibleCards.filter(r => r.anchorPage < 0 || r.cardPages.length === 0)
const badLinks = r1.linkRows.filter(l => l.cross || l.out)
console.log(`① 卡片同页: 纸页${r1.paperCount} 可见卡${visibleCards.length}/${r1.rows.length} 跨页卡${crossPageCards.length} 无页卡${noPage.length} 连线${r1.linkRows.length}条 跨页/出页连线${badLinks.length}`)
if (crossPageCards.length) console.log('   跨页卡详情:', JSON.stringify(crossPageCards))
if (badLinks.length) console.log('   坏连线详情:', JSON.stringify(badLinks))
const pass1 = r1.paperCount >= 2 && crossPageCards.length === 0 && noPage.length === 0 && badLinks.length === 0 && visibleCards.length >= 4

// 滚动一屏再验（跟随正文滚动）
await p.evaluate(() => {
  const pane = document.querySelector('.comments-pane')
  let scroll = pane.parentElement
  while (scroll && scroll.tagName !== 'HTML') {
    const st = getComputedStyle(scroll)
    if (/(auto|scroll)/.test(st.overflowY)) { scroll.scrollTop += 900; break }
    scroll = scroll.parentElement
  }
})
await p.waitForTimeout(900)
const r1b = await p.evaluate(() => {
  const pane = document.querySelector('.comments-pane')
  let scroll = pane.parentElement
  while (scroll && scroll.tagName !== 'HTML') {
    const st = getComputedStyle(scroll)
    if (/(auto|scroll)/.test(st.overflowY)) break
    scroll = scroll.parentElement
  }
  const papers = [...scroll.querySelectorAll('.pg-paper')].map(el => el.getBoundingClientRect())
  papers.sort((a, b) => a.top - b.top)
  const out = []
  for (const c of pane.querySelectorAll('.comment-card')) {
    const cid = c.id.replace('comment-card-', '')
    const m = scroll.querySelector(`.comment-mark[data-comment-id="${cid}"]`)
    const cr = c.getBoundingClientRect()
    if (cr.top < -5000) continue
    let anchorPage = -1
    if (m) {
      const mr = m.getBoundingClientRect()
      for (let i = 0; i < papers.length; i++) if (mr.top >= papers[i].top - 1 && mr.top <= papers[i].bottom + 1) { anchorPage = i; break }
    }
    let cardPages = []
    for (let i = 0; i < papers.length; i++) if (cr.bottom > papers[i].top + 2 && cr.top < papers[i].bottom - 2) cardPages.push(i)
    out.push({ id: cid, anchorPage, cardPages })
  }
  return out.filter(r => r.anchorPage >= 0 || r.cardPages.length > 0)
})
const crossB = r1b.filter(r => r.cardPages.length > 1 || (r.cardPages.length === 1 && r.anchorPage >= 0 && r.cardPages[0] !== r.anchorPage))
console.log(`   滚动后: 可见卡${r1b.length} 跨页卡${crossB.length} ${crossB.length === 0 ? '✓' : '✗ ' + JSON.stringify(crossB)}`)
const pass1b = crossB.length === 0

// ================= ② 表格手柄点击全选 =================
// 先把表格滚进视口（手柄几何同步走 rAF + scroll 监听）
await p.evaluate(() => {
  const t = document.querySelector('.tableWrapper table')
  const scroll = t?.closest('.overflow-auto')
  if (t && scroll) scroll.scrollTop = Math.max(0, t.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop - 200)
})
await p.waitForTimeout(600)
// 悬停表格让手柄出现，再点手柄
const tblBox = await p.evaluate(() => {
  const t = document.querySelector('.tableWrapper table')
  if (!t) return null
  const r = t.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + 10 }
})
if (!tblBox) { console.log('② ✗ 无表格'); process.exit(1) }
await p.mouse.move(tblBox.x, tblBox.y)
await p.waitForTimeout(350)
const handleInfo = await p.evaluate(() => {
  const hs = [...document.querySelectorAll('.pm-table-handle')].map(h => {
    const r = h.getBoundingClientRect()
    return { shown: h.classList.contains('pm-shown'), visible: r.width > 0 && getComputedStyle(h).display !== 'none', x: r.left + r.width / 2, y: r.top + r.height / 2, inHost: !!h.closest('.overflow-auto') || h.parentElement?.className === '' || true }
  })
  return hs
})
const shownHandle = handleInfo.find(h => h.shown && h.visible)
console.log(`② 手柄状态: ${handleInfo.length} 个，shown=${handleInfo.map(h => h.shown).join(',')} ${shownHandle ? '可见 ✓' : '✗ 不可见'}`)
if (shownHandle) {
  await p.mouse.click(shownHandle.x, shownHandle.y)
  await p.waitForTimeout(500)
  const selInfo = await p.evaluate(() => {
    const cells = document.querySelectorAll('.selectedCell').length
    return { cells }
  })
  console.log(`   点击后 selectedCell=${selInfo.cells} ${selInfo.cells >= 6 ? '✓ 全选生效' : '✗ 未全选'}`)
  var pass2 = selInfo.cells >= 6
} else { var pass2 = false }

// ================= ③ 按住手柄拖动移动表格 =================
if (shownHandle) {
  // 记录拖前文档顺序（表格前后段落文本）
  const before = await p.evaluate(() => {
    const pm = document.querySelector('.ProseMirror')
    return [...pm.children].map(c => (c.textContent || '').slice(0, 12))
  })
  // 目标：拖到"表格前的段落"上方（插到它前面 → 表格变成第一个块附近）
  const targetBox = await p.evaluate(() => {
    const pm = document.querySelector('.ProseMirror')
    const first = pm.children[0]
    const r = first.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + 4 }
  })
  await p.mouse.move(shownHandle.x, shownHandle.y)
  await p.waitForTimeout(200)
  await p.mouse.down()
  await p.waitForTimeout(120)
  // 分步移动（模拟真实拖拽，触发 armed 阈值）
  const steps = 12
  for (let i = 1; i <= steps; i++) {
    await p.mouse.move(
      shownHandle.x + (targetBox.x - shownHandle.x) * (i / steps),
      shownHandle.y + (targetBox.y - shownHandle.y) * (i / steps),
    )
    await p.waitForTimeout(40)
  }
  await p.waitForTimeout(250)
  const indShown = await p.evaluate(() => {
    const inds = [...document.querySelectorAll('div')].filter(d => d.style.display === 'block' && d.style.height === '2.5px' && d.style.background === 'rgb(37, 99, 235)')
    return inds.length
  })
  await p.mouse.up()
  await p.waitForTimeout(900)
  const after = await p.evaluate(() => {
    const pm = document.querySelector('.ProseMirror')
    return [...pm.children].map(c => (c.textContent || '').slice(0, 12))
  })
  const moved = JSON.stringify(before) !== JSON.stringify(after)
  // 表格应已移动（"列A列B列C"块的位置变化）
  const tBefore = before.findIndex(t => t.includes('列A'))
  const tAfter = after.findIndex(t => t.includes('列A'))
  console.log(`③ 拖拽: 指示线${indShown >= 1 ? '出现 ✓' : '未出现 ✗'} 表格块索引 ${tBefore}→${tAfter} ${tAfter !== tBefore ? '✓ 已移动' : '✗ 未移动'}`)
  var pass3 = indShown >= 1 && tAfter !== tBefore
} else { var pass3 = false }

const allPass = pass1 && pass1b && pass2 && pass3
console.log(`\n=== round39 结果: ①${pass1 && pass1b ? '✓' : '✗'} ②${pass2 ? '✓' : '✗'} ③${pass3 ? '✓' : '✗'} → ${allPass ? 'ALL PASS ✓' : 'FAIL ✗'} ===`)
await b.close()
process.exit(allPass ? 0 : 1)
