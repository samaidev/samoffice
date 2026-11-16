// 复现了！td[6]→td[8] 连续点击时 td[8] 触发 +6484 跳变。
// 单点 td[8] 不跳（t10）—— 差异在于【前一格的选中状态】。
// ★★★ 假设：td[6] 的 CellSelection 状态？不 —— td[6] 点击后是 TextSelection。
// 跳到 16142 —— 16142 是什么位置？查该滚动处的内容 + PM selection 5174
// 的 domAtPos 节点在哪个页面：
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
// td[6] 点击
let box = await p.evaluate(() => { const tds = [...document.querySelectorAll('td')]; const r = tds[6].getBoundingClientRect(); return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.5 } })
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(800)
// 现在查 5174（td[8]）的 domAtPos 位置
const info = await p.evaluate(() => {
  const v = window.__pmView
  try {
    const dom = v.domAtPos(5174)
    const el = dom.node.nodeType === 3 ? dom.node.parentElement : dom.node
    const r = el.getBoundingClientRect()
    const scrollEl = document.querySelector('.overflow-auto')
    // el 在滚动容器里的绝对位置
    return {
      elTag: el.tagName, elText: el.textContent?.slice(0, 12),
      rectTop: Math.round(r.top),
      docOffsetTop: Math.round(r.top + scrollEl.scrollTop),
      currentScroll: scrollEl.scrollTop,
    }
  } catch (e) { return { err: String(e).slice(0, 60) } }
})
console.log('pos 5174 的 DOM 位置:', JSON.stringify(info))
// td[8] 点击 + 跳变后 16142 处是什么内容
box = await p.evaluate(() => { const tds = [...document.querySelectorAll('td')]; const r = tds[8].getBoundingClientRect(); return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.5 } })
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(800)
const after = await p.evaluate(() => {
  const scrollEl = document.querySelector('.overflow-auto')
  // 视口中央的内容
  const el = document.elementFromPoint(680, 450)
  return { scroll: scrollEl.scrollTop, centerContent: (el?.textContent || '').slice(0, 20), centerTag: el?.tagName }
})
console.log('跳变后:', JSON.stringify(after))
await b.close()
