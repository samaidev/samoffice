// e2e_round46.mjs — 公式保真（行内公式/OMML 往返）E2E
// 前置：/tmp/samoffice-server 已在 127.0.0.1:18400 运行（frontend/dist 已构建）
import { chromium } from 'playwright'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const BASE = 'http://localhost:18400'
const SHOTS = '/home/z/my-project/samoffice/scripts/e2e/round46-shots'
mkdirSync(SHOTS, { recursive: true })
const results = []

async function main() {
  const browser = await chromium.launch({ args: ['--no-sandbox'] })
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 150)) })

  // 1) API 打开原始 docx（46 个公式），拿 UDM
  const docx = readFileSync('/tmp/formula_cmp/orig.docx')
  const form = new FormData()
  form.append('file', new Blob([docx]), 'contract.docx')
  const r = await fetch(`${BASE}/api/doc/open`, { method: 'POST', body: form })
  const j = await r.json()
  results.push(['API open docx', !j.error, JSON.stringify(j.error || 'ok').slice(0, 80)])

  // UDM 统计：InlineMath（行内公式，带 omml）
  const blocks = (j.document && j.document.blocks) || []
  let inlineMath = 0, blockMath = 0, withOmml = 0
  const walk = (bs) => {
    for (const b of bs) {
      if (b.type === 'math') { blockMath++; if (b.omml) withOmml++ }
      if (Array.isArray(b.inline)) inlineMath += b.inline.filter(it => 'formula' in it).length
      if (b.rows) for (const row of b.rows) for (const c of row) walk(c.blocks || [])
      if (b.items) for (const it of b.items) walk(it)
    }
  }
  walk(blocks)
  results.push(['UDM inline math=46', inlineMath === 46, `inline=${inlineMath} block=${blockMath} omml=${withOmml}`])

  // 2) 前端加载：走 __setDocForTest 正规打开路径
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(1500)
  const injected = await page.evaluate((doc) => {
    const w = window
    if (typeof w.__setDocForTest === 'function') { w.__setDocForTest(doc); return 'hook' }
    return 'no-hook'
  }, j.document)
  results.push(['inject via hook', injected === 'hook', injected])
  await page.waitForTimeout(4500)

  const pm = await page.$('.ProseMirror')
  results.push(['ProseMirror present', !!pm, ''])
  const mathCount = await page.evaluate(() => document.querySelectorAll('.sam-math').length)
  const inlineInPara = await page.evaluate(() => document.querySelectorAll('p span.sam-math').length)
  const katexCount = await page.evaluate(() => document.querySelectorAll('.sam-math .katex').length)
  results.push(['DOM .sam-math >= 40', mathCount >= 40, `total=${mathCount}`])
  results.push(['inline math inside <p> >= 40', inlineInPara >= 40, `p>span=${inlineInPara}`])
  results.push(['KaTeX rendered >= 40', katexCount >= 40, `katex=${katexCount}`])
  results.push(['no pageerror', errors.length === 0, errors.slice(0, 3).join(' | ').slice(0, 200)])

  // 3) 关键字符完整性：保存过的旧版会把 ≤ 变成 "le"、省略号变乱码；
  //    KaTeX 渲染后 DOM 里应有正确的 ≤/≥（.mrel / vlist 文本）
  const relCheck = await page.evaluate(() => {
    const txt = document.body.innerText || ''
    return { hasLe: txt.includes('≤'), hasGe: txt.includes('≥'), hasMoji: /Ã¢|Ã©|Â¤/.test(txt) }
  })
  results.push(['≤/≥ render (not "le"/"ge")', relCheck.hasLe && relCheck.hasGe, JSON.stringify(relCheck)])
  results.push(['no mojibake', !relCheck.hasMoji, JSON.stringify(relCheck)])

  // 4) 分页稳定性：纸页数量连续采样一致（__pg 诊断默认关闭，改用 .pg-paper）
  const pgn = await page.evaluate(async () => {
    const read = () => document.querySelectorAll('.pg-paper').length
    const a = read()
    await new Promise(rr => setTimeout(rr, 1500))
    const b = read()
    return { a, b }
  })
  results.push(['pagination stable', pgn.a === pgn.b && pgn.a > 0, `${pgn.a}/${pgn.b}`])

  // 截图：滚动到第一个公式
  const firstMath = await page.$('span.sam-math')
  if (firstMath) {
    await firstMath.scrollIntoViewIfNeeded()
    await page.waitForTimeout(800)
  }
  await page.screenshot({ path: join(SHOTS, 'round46-inline-math.png') })

  const lines = results.map(([n, ok, info]) => `${ok ? 'PASS' : 'FAIL'}  ${n}  ${info}`)
  console.log(lines.join('\n'))
  writeFileSync(join(SHOTS, 'results.json'), JSON.stringify(results, null, 2))
  await browser.close()
  if (lines.some(l => l.startsWith('FAIL'))) process.exit(1)
}
main().catch(e => { console.error('E2E ERROR', e); process.exit(2) })
