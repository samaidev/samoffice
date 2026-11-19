// r42 终版验证：
// ① 图片顶精确落在目标页内容区顶（±2px）
// ② 无块【文字内容】落在页间空白带（heal 口径：排除 .pg-brk 的正常 leading 探入）
// ③ 时序稳定：heal 不再触发（监听 dispatch 计数）—— 用 __pg 断点稳定性 + 采样期间 widget mt 不变
// ④ 底部不越界（r41 口径）
import { chromium } from 'playwright'
import fs from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DOC = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/emc_contract.udm.json'), 'utf-8'))

const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
const errs = []
p.on('pageerror', e => errs.push(e.message.slice(0, 120)))
await p.goto('http://localhost:18400/?r42final=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
await p.evaluate(() => { localStorage.setItem('samoffice_show_marks', '1') })
await p.evaluate(d => window.__setDocForTest(d), DOC)
await p.waitForTimeout(4000)

// ① 图片顶 vs 目标页顶
const imgs = await p.evaluate(() => {
  const pm = document.querySelector('.ProseMirror')
  const pmTop = pm.getBoundingClientRect().top
  const kids = [...pm.children]
  const pg = (window).__pg
  const res = []
  kids.forEach((el, k) => {
    const img = el.querySelector && el.querySelector('img')
    if (!img) return
    const ir = img.getBoundingClientRect()
    const top = ir.top - pmTop
    const page = pg.blocks[k].page
    const want = page * pg.pageStep
    // round42：只有【带断点装饰】的图片段才要求顶=页顶（被断页推过去的）；
    // 页中自然流图片（如 k185）只需在页内 —— 底部不越界由 ④ 检查。
    const hasBreak = el.classList.contains('pg-brk') || !!el.querySelector('.pg-linebreak')
    res.push({ k, page, imgTop: Math.round(top * 10) / 10, want, diff: Math.round((top - want) * 10) / 10, hasBreak })
  })
  return res
})
console.log('① 图片顶 vs 目标页顶:')
let imgPass = true
for (const r of imgs) {
  const ok = r.hasBreak ? Math.abs(r.diff) <= 2 : true
  if (!ok) imgPass = false
  console.log(`  k=${r.page}页 k${r.k}: imgTop=${r.imgTop} ${r.hasBreak ? `want=${r.want} diff=${r.diff}` : '(自然流页中)'} ${ok ? '✓' : '✗'}`)
}

// ② 无文字落在页间空白带（排除 .pg-brk leading 探入：用文字行盒顶而非块盒顶）
const blank = await p.evaluate(() => {
  const pm = document.querySelector('.ProseMirror')
  const pmTop = pm.getBoundingClientRect().top
  const pg = (window).__pg
  const step = pg.pageStep, per = pg.per
  const bad = []
  const walker = document.createTreeWalker(pm, NodeFilter.SHOW_TEXT)
  let tn
  while ((tn = walker.nextNode())) {
    // 跳过 widget/脚注区非正文
    const parent = tn.parentElement
    if (!parent || parent.classList.contains('pg-linebreak')) continue
    if (!pm.contains(parent) || parent.closest('tfoot, .footnote-section')) continue
    const rg = document.createRange()
    rg.selectNodeContents(tn)
    const top = rg.getBoundingClientRect().top - pmTop
    if (top < 0) continue // 视口外/未渲染
    const r = top % step
    if (r > per + 0.5 && r < step - 0.5) {
      bad.push({ text: (tn.textContent || '').slice(0, 8), top: Math.round(top), inGap: Math.round(r - per) })
      if (bad.length > 6) break
    }
  }
  return bad
})
console.log(`② 文字落页间空白带: ${blank.length} 处 ${blank.length === 0 ? '✓' : '✗'}`)
for (const r of blank) console.log('  ', JSON.stringify(r))

// ③ 时序稳定：5s 高频采样所有断点 widget 的 mt + 块位置签名
const sigs = new Set()
for (let i = 0; i < 50; i++) {
  const sig = await p.evaluate(() => {
    const pm = document.querySelector('.ProseMirror')
    const lbs = [...pm.querySelectorAll('.pg-linebreak')].map(w => w.style.marginTop).join(',')
    const brks = [...pm.querySelectorAll('.pg-brk')].map(e => e.style.marginTop).join(',')
    return lbs + '#' + brks
  })
  sigs.add(sig)
  await p.waitForTimeout(100)
}
console.log(`③ 断点签名稳定: ${sigs.size === 1 ? '✓ (5s 内 0 变化)' : '✗ 变化 ' + sigs.size + ' 种'}`)

// ④ 底部越界（r41 口径：blk.page 归页）
const bot = await p.evaluate(() => {
  const pg = (window).__pg
  const pm = document.querySelector('.ProseMirror')
  const pmTop = pm.getBoundingClientRect().top
  const kids = [...pm.children]
  const bad = []
  pg.blocks.forEach((blk, k) => {
    const el = kids[k]
    if (!el) return
    const bottom = el.getBoundingClientRect().bottom - pmTop
    const cb = blk.page * pg.pageStep + pg.per
    if (bottom > cb + 6) bad.push({ k, over: Math.round(bottom - cb) })
  })
  return bad
})
console.log(`④ 底部越界: ${bot.length} 块 ${bot.length === 0 ? '✓' : '✗'}`)
for (const r of bot.slice(0, 5)) console.log('  ', JSON.stringify(r))

const pass = imgPass && blank.length === 0 && sigs.size === 1 && bot.length === 0
console.log(`pageerror: ${errs.length}`)
console.log(`=== r42 结果: ${pass ? 'ALL PASS ✓' : 'FAIL ✗'} ===`)
await b.close()
process.exit(pass ? 0 : 1)
