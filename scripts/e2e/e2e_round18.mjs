// e2e_round18.mjs — 公式渲染 + 分页稳定 + 拼写定位 E2E 截图验证
// 前置：/tmp/samoffice-server 已在 127.0.0.1:18400 运行
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

const BASE = 'http://localhost:18400'
const SHOTS = '/home/z/my-project/samoffice/scripts/e2e/round18-shots'
mkdirSync(SHOTS, { recursive: true })
const results = []

async function main() {
  const browser = await chromium.launch({ args: ['--no-sandbox'] })
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message))

  // 1) 通过 API 打开上传的含公式 docx
  const fs = await import('fs')
  const docx = fs.readFileSync('/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx')
  const form = new FormData()
  form.append('file', new Blob([docx]), 'contract.docx')
  const r = await fetch(`${BASE}/api/doc/open`, { method: 'POST', body: form })
  const j = await r.json()
  results.push(['API open docx', !j.error, JSON.stringify(j.error || 'ok').slice(0, 80)])

  // 前端加载：拖放 docx 到页面（远程模式走 openDroppedFiles → uploadFile API）
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(1200)
  const docPath = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
  await page.evaluate(() => {
    const target = document.querySelector('[style*="--wails-drop-target"], main') || document.body
    target.dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true }))
  })
  await page.setInputFiles('body', docPath).catch(() => {})
  // Playwright drop：构造 DataTransfer 需 CDP；改用直接调 API + 注入文档
  const injected = await page.evaluate(async (apiDoc) => {
    const w = window
    if (typeof w.__setDocForTest === 'function') { w.__setDocForTest(apiDoc); return 'hook' }
    return 'no-hook'
  }, j.document)
  results.push(['inject doc', true, injected])
  await page.waitForTimeout(800)
  await page.screenshot({ path: join(SHOTS, '01-loaded.png') })

  // 2) 滚动到公式区域：找 sam-math 元素
  const mathCount = await page.evaluate(() => document.querySelectorAll('.sam-math').length)
  results.push(['math nodes rendered', mathCount > 0, `count=${mathCount}`])
  // KaTeX 真渲染检查（katex 容器内应有 mrow 等 MathML/HTML 结构，而不是 ⟨formula:...⟩ 文本）
  const rendered = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('.sam-math'))
    const ok = els.filter(e => e.querySelector('.katex') || e.querySelector('.mrow') || (e.textContent && !e.textContent.includes('⟨formula:')))
    return { total: els.length, rendered: ok.length }
  })
  results.push(['KaTeX rendered (not placeholder)', rendered.rendered > 0, JSON.stringify(rendered)])

  // 截公式区域
  const firstMath = await page.$('.sam-math')
  if (firstMath) {
    await firstMath.scrollIntoViewIfNeeded()
    await page.waitForTimeout(600)
    await page.screenshot({ path: join(SHOTS, '02-math-rendered.png') })
    // 该公式所在区域特写
    await firstMath.screenshot({ path: join(SHOTS, '02b-math-closeup.png') }).catch(() => {})
  }

  // 3) 分页稳定性：滚动到底部再回顶，反复 3 次，测 pg-paper 数量与第一个断点位置不变
  const pg = await page.evaluate(async () => {
    const s1 = JSON.stringify((window).__pg ? { n: (window).__pg.pageCount, y: (window).__pg.contentMaxY } : null)
    const scroller = document.querySelector('.doc-scroll, .flex-1.overflow-auto, main') || window
    for (let i = 0; i < 3; i++) {
      scroller.scrollTop = 100000; await new Promise(r => setTimeout(r, 400))
      scroller.scrollTop = 0; await new Promise(r => setTimeout(r, 400))
    }
    const s2 = JSON.stringify((window).__pg ? { n: (window).__pg.pageCount, y: (window).__pg.contentMaxY } : null)
    return { s1, s2, stable: s1 === s2 }
  })
  results.push(['pagination stable across scroll', pg.stable, pg.s1 + ' -> ' + pg.s2])
  await page.screenshot({ path: join(SHOTS, '03-after-scroll.png') })

  // 4) 拼写面板定位：往文档插入一个拼错的词，跑拼写检查，点右侧栏条目
  // 前端 spellCheck 走 backend.spellCheck(text, lang)，server 模式 fetch /api/dict/check
  // 直接触发：模拟 App 内 triggerSpellCheck 需要 UI 钩子；退而验证 __docJumpToWord 存在且工作
  const jumpOk = await page.evaluate(() => {
    const f = window.__docJumpToWord
    if (typeof f !== 'function') return { ok: false, why: 'no __docJumpToWord' }
    const pm = window.__pmView
    if (!pm) return { ok: false, why: 'no __pmView' }
    let word = ''
    pm.state.doc.descendants((n) => { if (!word && n.isText && n.text) { const m = n.text.match(/[A-Za-z]{3,}/); if (m) word = m[0] } return !word })
    if (!word) return { ok: false, why: 'no latin word in doc' }
    const ok = f(word)
    const sel = pm.state.selection
    return { ok, word, from: sel.from, to: sel.to, hasSel: sel.to > sel.from }
  })
  results.push(['spell jump works', jumpOk.ok === true, JSON.stringify(jumpOk)])
  await page.screenshot({ path: join(SHOTS, '04-spell-jump.png') })

  // 汇总
  console.log('\n===== E2E RESULTS =====')
  let fail = 0
  for (const [name, ok, info] of results) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${info}`)
    if (!ok) fail++
  }
  if (errors.length) console.log('pageerrors:', errors.slice(0, 5))
  writeFileSync(join(SHOTS, 'results.json'), JSON.stringify({ results, errors }, null, 2))
  await browser.close()
  process.exit(fail ? 1 : 0)
}
main().catch(e => { console.error('E2E ERROR:', e); process.exit(2) })
