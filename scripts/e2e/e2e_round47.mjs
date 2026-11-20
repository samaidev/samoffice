// e2e_round47.mjs — 列表序号样式 E2E：打开含 [1]/(1)/1)/① 列表的 docx，
// 验证前端渲染（::before 序号文本）+ 序号样式下拉 + 切换样式 + 圈号字符
import { chromium } from 'playwright'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const BASE = 'http://localhost:18400'
const SHOTS = '/home/z/my-project/samoffice/scripts/e2e/round47-shots'
mkdirSync(SHOTS, { recursive: true })
const results = []

async function main() {
  const browser = await chromium.launch({ args: ['--no-sandbox'] })
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message))

  // 1) API 打开构造好的列表测试 docx（cmd/listrt 生成）
  const docx = readFileSync('/tmp/listrt.docx')
  const form = new FormData()
  form.append('file', new Blob([docx]), 'lists.docx')
  const r = await fetch(`${BASE}/api/doc/open`, { method: 'POST', body: form })
  const j = await r.json()
  results.push(['API open docx', !j.error, JSON.stringify(j.error || 'ok').slice(0, 60)])

  // UDM 断言：4 种样式列表
  const blocks = (j.document && j.document.blocks) || []
  const styles = blocks.filter(b => b.ordered && b.items).map(b => b.style || '(default)')
  results.push(['UDM styles parsed', styles.includes('[n]') && styles.includes('(n)') && styles.includes('circle-num'), styles.join(',')])

  // 2) 前端注入并等分页
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(1200)
  await page.evaluate((doc) => window.__setDocForTest(doc), j.document)
  // 等分页首轮回调（onCount → applyCircleGlyphs）跑完再断言
  await page.waitForFunction(() => {
    const v = window.__pmView
    if (!v) return false
    const li = v.dom.querySelector('ol[data-num-style="circle-num"] li')
    return !!li && !!li.getAttribute('data-glyph')
  }, { timeout: 15000 }).catch(() => null)
  await page.waitForTimeout(500)
  // 派发空事务触发 applyCircleGlyphs，并在同一 evaluate 内同步读回 glyph

  // 3) 序号渲染断言：li::before 的实际文本（getComputedStyle content 不可读，
  //    用 polyfill 读 pseudo style）
  const numTexts = await page.evaluate(() => {
    const out = []
    document.querySelectorAll('ol.num-list').forEach((ol) => {
      const style = ol.getAttribute('data-num-style') || ol.className
      const li = ol.querySelector('li')
      if (!li) return
      const before = getComputedStyle(li, '::before').content
      out.push({ style, before: before.replace(/^"|"$/g, '') })
    })
    return out
  })
  const byStyle = {}
  numTexts.forEach(n => { byStyle[n.style] = n.before })
  // Chromium 的 getComputedStyle(::before).content 返回未求值模板串
  // （'"[" counter(numitem) "]"'）—— 断言模板结构而非求值文本；求值效果走截图
  const norm = (x) => (x || '').replace(/"/g, '').replace(/\s+/g, ' ').trim()
  results.push(['[1] template', norm(byStyle['[n]']) === '[ counter(numitem) ]', JSON.stringify(byStyle['[n]'])])
  results.push(['(1) template', norm(byStyle['(n)']) === '( counter(numitem) )', JSON.stringify(byStyle['(n)'])])
  results.push(['1) template', norm(byStyle['n)']) === 'counter(numitem) )', JSON.stringify(byStyle['n)'])])
  // circle-num：JS 补 data-glyph ①（只在 PM 编辑器 dom 内查 —— 页面里还有
  // 预览克隆，克隆无 glyph 会误判）
  const circle = await page.evaluate(() => {
    const v = window.__pmView
    if (!v) return null
    const li = v.dom.querySelector('ol[data-num-style="circle-num"] li')
    if (!li) return null
    return { glyph: li.getAttribute('data-glyph'), before: getComputedStyle(li, '::before').content }
  })
  results.push(['① glyph applied', circle && circle.glyph === '①', JSON.stringify(circle)])

  // 4) 序号样式下拉存在
  const dropdown = await page.$('[data-testid="numbering-style"]')
  results.push(['numbering style dropdown', !!dropdown, ''])

  // 5) 切换样式：光标放进 circle 列表第一项，下拉选 [n]
  if (dropdown) {
    await page.evaluate(() => {
      const li = document.querySelector('ol[data-num-style="circle-num"] li p')
      if (!li) return
      const sel = window.getSelection()
      const range = document.createRange()
      range.setStart(li.firstChild || li, 0)
      range.collapse(true)
      sel.removeAllRanges()
      sel.addRange(range)
      li.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    await page.waitForTimeout(600)
    // 点开下拉（触发按钮），在 portal .ribbon-popup 里找 "[1] [2] [3]" 项
    await dropdown.click()
    await page.waitForTimeout(500)
    const item = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('.ribbon-popup button'))
      const el = btns.find(b => (b.textContent || '').includes('[1] [2] [3]'))
      if (el) { el.click(); return el.textContent }
      return null
    })
    await page.waitForTimeout(800)
    const afterStyle = await page.evaluate(() => {
      const ol = document.querySelector('ol.num-list')
      return ol ? ol.getAttribute('data-num-style') : '(none)'
    })
    results.push(['style switch via UI', !!item && afterStyle === '[n]', `item=${!!item} after=${afterStyle}`])
  }

  await page.screenshot({ path: join(SHOTS, 'round47-lists.png') })
  results.push(['no pageerror', errors.length === 0, errors.slice(0, 2).join(' | ').slice(0, 150)])

  const lines = results.map(([n, ok, info]) => `${ok ? 'PASS' : 'FAIL'}  ${n}  ${info}`)
  console.log(lines.join('\n'))
  writeFileSync(join(SHOTS, 'results.json'), JSON.stringify(results, null, 2))
  await browser.close()
  if (lines.some(l => l.startsWith('FAIL'))) process.exit(1)
}
main().catch(e => { console.error('E2E ERROR', e); process.exit(2) })
