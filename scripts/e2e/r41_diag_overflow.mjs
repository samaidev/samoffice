// r41 诊断：加载 EMC 合同文档 → 激活「显示标记」→ 截图 + 测量内容是否超出四角直角划定范围
import { chromium } from 'playwright'
import fs from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DOC = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/emc_contract.udm.json'), 'utf-8'))
const OUT_DIR = '/home/z/my-project/samoffice/scripts/e2e/shots-r41'
fs.mkdirSync(OUT_DIR, { recursive: true })

const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
const errs = []
p.on('pageerror', e => errs.push(e.message.slice(0, 150)))
p.on('console', m => { if (m.type() === 'error' && /PAGINATION|RENDER/.test(m.text())) console.log('  [console]', m.text().slice(0, 160)) })

await p.goto('http://localhost:18400/?r41=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
await p.evaluate(d => window.__setDocForTest(d), DOC)
await p.waitForTimeout(4500)

// 激活「显示标记」（¶ 按钮，title 匹配）
const marksBtn = p.locator('button[title*="标记"], button[title*="编辑标记"]').first()
const found = await marksBtn.count()
if (!found) {
  // 兜底：直接找 ¶ 图标的按钮
  const all = await p.locator('button').allTextContents()
  console.log('未找到标记按钮，按钮文本样例:', all.filter(t => t.includes('¶')).slice(0, 3))
} else {
  await marksBtn.click()
  await p.waitForTimeout(800)
}
const marksOn = await p.evaluate(() => localStorage.getItem('samoffice_show_marks') === '1')
console.log('显示标记激活:', marksOn)

// 等分页稳定
await p.waitForTimeout(2000)

// 测量：每个纸页的角标范围 vs 内容块实际位置
const audit = await p.evaluate(() => {
  const papers = [...document.querySelectorAll('.pg-paper')]
  const pm = document.querySelector('.ProseMirror')
  const zoom = parseInt(localStorage.getItem('samoffice_zoom') || '100') / 100
  // 纸页几何（视觉 px）
  const out = { pages: papers.length, zoom, overflow: [], pageRects: [] }
  papers.forEach((pp, i) => {
    const pr = pp.getBoundingClientRect()
    out.pageRects.push({ i, top: Math.round(pr.top), bottom: Math.round(pr.bottom), left: Math.round(pr.left), right: Math.round(pr.right) })
  })
  // 所有顶级内容块（段落/表格/标题）逐个检查：其视觉 rect 是否落在某张纸的内容区内
  // 内容区 = 纸页 inset 页边距（docMargins 来自角标：top 72pt?—— 从直角 span 推）
  const corner = pp0 => pp0.querySelector('span[style*="border-top"]')
  const firstCorner = papers[0] ? corner(papers[0]) : null
  // 直接读 margins：角标 style top/left
  let mt = 72, ml = 90, mb = 72, mr = 90
  if (firstCorner) {
    mt = parseInt(firstCorner.style.top) || 72
    ml = parseInt(firstCorner.style.left) || 90
  }
  out.margins = { mt, ml }
  const kids = [...pm.children]
  kids.forEach((el, k) => {
    const r = el.getBoundingClientRect()
    if (!r.height) return
    // 找块底/块顶落在哪张纸
    for (const pg of out.pageRects) {
      const contentTop = pg.top + mt * zoom
      const contentBottom = pg.bottom - mb * zoom
      // 块与该纸内容区有交集
      if (r.bottom > pg.top && r.top < pg.bottom) {
        const over = r.bottom - contentBottom
        if (over > 4) {
          out.overflow.push({ block: k, tag: el.tagName, cls: String(el.className).slice(0, 24), text: (el.textContent || '').slice(0, 14), page: pg.i, bottom: Math.round(r.bottom), contentBottom: Math.round(contentBottom), over: Math.round(over) })
        }
        break
      }
    }
  })
  return out
})
console.log('纸页数:', audit.pages, 'zoom:', audit.zoom, 'margins(pt):', JSON.stringify(audit.margins))
console.log('纸页几何:', JSON.stringify(audit.pageRects))
console.log('超出内容区底部的块:', audit.overflow.length)
for (const o of audit.overflow.slice(0, 12)) console.log('  ', JSON.stringify(o))

// 截图：全文多屏（滚动采样前 3 屏）
const scroll = await p.evaluate(() => {
  let el = document.querySelector('.ProseMirror')
  while (el && el.tagName !== 'HTML') { if (/(auto|scroll)/.test(getComputedStyle(el).overflowY)) return el; el = el.parentElement }
  return null
})
if (scroll) {
  const H = await p.evaluate(el => el.scrollHeight, scroll)
  console.log('滚动高度:', H)
  for (let s = 0, i = 0; s < Math.min(H, 3200); s += 800, i++) {
    await p.evaluate((el, y) => el.scrollTo(0, y), scroll, s)
    await p.waitForTimeout(400)
    await p.screenshot({ path: `${OUT_DIR}/page-${String(i + 1).padStart(2, '0')}.png` })
  }
}
console.log('pageerror:', errs.length, errs.slice(0, 3))
await b.close()
console.log('截图目录:', OUT_DIR)
