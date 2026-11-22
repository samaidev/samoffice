// probe_marks.mjs — 查 label 的祖先链 class + 应用的 CSS 规则
import { chromium } from 'playwright'

const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
await p.goto('http://localhost:18400', { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
await p.evaluate(() => { localStorage.setItem('samoffice_lang', 'zh') })
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
await p.locator('[data-testid="menu-files"]').click(); await p.waitForTimeout(400)
await p.locator('text=📝').first().click(); await p.waitForTimeout(1000)
await p.evaluate(() => {
  const para = (txt) => ({ type: 'paragraph', inline: [{ content: txt }] })
  window.__setDocForTest({ meta: { title: 't' }, blocks: [para('甲'), { type: 'pageBreak', restart: false, startNumber: 1 }, para('乙')] })
})
await p.waitForTimeout(1200)
// 开显示标记
const btn = p.locator('button').filter({ hasText: /^¶/ }).first()
const wasActive = await btn.evaluate(el => el.className.includes('active'))
if (!wasActive) { await btn.click(); await p.waitForTimeout(500) }
const info = await p.evaluate(() => {
  const label = document.querySelector('.page-break-label')
  if (!label) return { found: false }
  const chain = []
  let el = label.parentElement
  while (el && chain.length < 14) {
    const cls = (el.className || '').split(' ').filter(Boolean)
    chain.push(el.tagName + (cls.length ? '.' + cls.join('.') : ''))
    el = el.parentElement
  }
  const cs = getComputedStyle(label)
  // 找出匹配规则 + 检查新规则是否已加载
  const matched = []
  let newRuleLoaded = false
  for (const sheet of document.styleSheets) {
    let rules; try { rules = sheet.cssRules } catch { continue }
    for (const r of rules) {
      if (r.selectorText && r.cssText.includes('translate(-50%, -100%)')) newRuleLoaded = true
      if (r.selectorText && r.selectorText.includes('page-break-label')) {
        try { if (label.matches(r.selectorText)) matched.push(r.selectorText + ' {' + r.style.cssText.slice(0, 100) + '}') } catch { /* */ }
      }
    }
  }
  const inShowMarks = !!label.closest('.show-marks')
  const inShowEdit = !!label.closest('.show-edit-marks')
  return { found: true, display: cs.display, position: cs.position, top: cs.top, inShowMarks, inShowEdit, newRuleLoaded, chain, matched }
})
console.log(JSON.stringify(info, null, 1))
await b.close()
