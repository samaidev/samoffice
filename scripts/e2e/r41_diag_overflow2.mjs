// r41 诊断 v2：加载 EMC 合同 → 激活显示标记 → 截图（分屏滚动）+ 溢出审计
import { chromium } from 'playwright'
import fs from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DOC = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/emc_contract.udm.json'), 'utf-8'))
const OUT_DIR = '/home/z/my-project/samoffice/scripts/e2e/shots-r41'
fs.rmSync(OUT_DIR, { recursive: true, force: true })
fs.mkdirSync(OUT_DIR, { recursive: true })

const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
const errs = []
p.on('pageerror', e => errs.push(e.message.slice(0, 150)))

await p.goto('http://localhost:18400/?r41v2=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
await p.evaluate(d => window.__setDocForTest(d), DOC)
await p.waitForTimeout(4500)

// 激活「显示标记」（label 文本）
await p.evaluate(() => {
  const btns = [...document.querySelectorAll('button')]
  const target = btns.find(x => x.textContent?.includes('显示标记') || x.textContent?.includes('Show Marks') || x.textContent?.trim() === '¶Body' || x.textContent?.includes('¶'))
  if (target) target.click()
  else { window.__r41NoBtn = [...btns].map(x => (x.textContent || '').trim()).filter(Boolean).slice(0, 40) }
})
await p.waitForTimeout(1000)
console.log('显示标记:', await p.evaluate(() => localStorage.getItem('samoffice_show_marks') === '1'))
const noBtn = await p.evaluate(() => (window).__r41NoBtn)
if (noBtn) console.log('按钮列表:', JSON.stringify(noBtn))

// 滚动容器（overflow-auto 的最近祖先——DocumentEditor 的 flex-1 overflow-auto）
const scrollSel = await p.evaluate(() => {
  const pm = document.querySelector('.ProseMirror')
  let el = pm
  while (el && el.tagName !== 'HTML') {
    if (/(auto|scroll)/.test(getComputedStyle(el).overflowY)) { el.setAttribute('data-r41scroll', '1'); return '[data-r41scroll="1"]' }
    el = el.parentElement
  }
  return null
})
console.log('滚动容器:', scrollSel)
if (scrollSel) {
  const H = await p.evaluate(sel => document.querySelector(sel).scrollHeight, scrollSel)
  console.log('滚动高度:', H)
  for (let s = 0, i = 0; s < H; s += 820, i++) {
    await p.evaluate(({ sel, y }) => { document.querySelector(sel).scrollTo(0, y) }, { sel: scrollSel, y: s })
    await p.waitForTimeout(450)
    await p.screenshot({ path: `${OUT_DIR}/screen-${String(i + 1).padStart(2, '0')}.png` })
  }
  console.log('截图完成')
}
// 溢出块详情（含公式段标记）
const detail = await p.evaluate(() => {
  const pm = document.querySelector('.ProseMirror')
  const papers = [...document.querySelectorAll('.pg-paper')]
  const zoom = 1
  const mt = 72, mb = 72
  const list = []
  ;[...pm.children].forEach((el, k) => {
    const r = el.getBoundingClientRect()
    if (!r.height) return
    for (let i = 0; i < papers.length; i++) {
      const pr = papers[i].getBoundingClientRect()
      if (r.bottom > pr.top && r.top < pr.bottom) {
        const over = r.bottom - (pr.bottom - mb * zoom)
        if (over > 4) {
          const hasMath = !!el.querySelector('.math-block, [data-latex], .katex')
          list.push({ k, tag: el.tagName, math: hasMath, len: (el.textContent || '').length, over: Math.round(over), page: i, h: Math.round(r.height) })
        }
        break
      }
    }
  })
  return list
})
console.log('溢出块明细:', JSON.stringify(detail))
console.log('pageerror:', errs.length, errs.slice(0, 3))
await b.close()
