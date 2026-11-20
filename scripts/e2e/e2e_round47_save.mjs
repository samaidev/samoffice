// e2e_round47_save.mjs — 列表序号样式 UI 保存链路：打开→改样式→保存→重新解析验证
import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'fs'

const BASE = 'http://localhost:18400'
const results = []

async function main() {
  const browser = await chromium.launch({ args: ['--no-sandbox'] })
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))

  const docx = readFileSync('/tmp/listrt.docx')
  const form = new FormData()
  form.append('file', new Blob([docx]), 'lists.docx')
  const r = await fetch(`${BASE}/api/doc/open`, { method: 'POST', body: form })
  const j = await r.json()

  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  await page.evaluate((doc) => window.__setDocForTest(doc), j.document)
  await page.waitForTimeout(3500)

  // 拦截保存
  let savedBuf = null
  let reqBody = ''
  await page.route('**/api/doc/save', async (route) => {
    try {
      const req = route.request()
      reqBody = req.postData() || ''
      const resp = await route.fetch()
      savedBuf = await resp.body()
      await route.fulfill({ response: resp, body: savedBuf })
    } catch { await route.abort() }
  })

  // 光标进 (n) 列表 → 下拉改成 circle-num（①）
  await page.evaluate(() => {
    const li = document.querySelector('ol[data-num-style="(n)"] li p')
    if (!li) return
    const sel = window.getSelection()
    const range = document.createRange()
    range.setStart(li.firstChild || li, 0)
    range.collapse(true)
    sel.removeAllRanges(); sel.addRange(range)
    li.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  })
  await page.waitForTimeout(500)
  await page.click('[data-testid="numbering-style"]')
  await page.waitForTimeout(500)
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('.ribbon-popup button'))
    const el = btns.find(b => (b.textContent || '').includes('① ② ③'))
    if (el) el.click()
  })
  await page.waitForTimeout(800)

  // 验证样式切换已生效（保存前）
  const stylesBefore = await page.evaluate(() => {
    const v = window.__pmView
    return Array.from(v.dom.querySelectorAll('ol.num-list')).map(o => o.getAttribute('data-num-style'))
  })
  console.log('styles before save:', JSON.stringify(stylesBefore))
  const switchOk = stylesBefore.filter(s => s === 'circle-num').length === 2

  // 保存
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'))
    const menuBtn = btns.find(b => /Files/i.test(b.textContent || ''))
    if (menuBtn) menuBtn.click()
  })
  await page.waitForTimeout(500)
  await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('button, div'))
    const save2 = items.find(b => (b.textContent || '').trim().startsWith('💾'))
    if (save2) save2.click()
  })
  await page.waitForTimeout(4000)

  let pass = false, info = 'no save response'
  if (savedBuf && savedBuf.length > 1000) {
    writeFileSync('/tmp/list_ui_saved.docx', savedBuf)
    info = `saved ${savedBuf.length}B`
    // 重新解析验证：circle-num 应变成 2 个（原1 + 改的1）
    const r2 = await fetch(`${BASE}/api/doc/open`, { method: 'POST', body: (() => { const f = new FormData(); f.append('file', new Blob([savedBuf]), 'saved.docx'); return f })() })
    const j2 = await r2.json()
    const styles2 = (j2.document.blocks || []).filter(b => b.ordered && b.items).map(b => b.style || '')
    const circleCount = styles2.filter(s => s === 'circle-num').length
    pass = switchOk && circleCount === 2
    info += ` | switchOk=${switchOk} reopen circles=${circleCount} styles=${styles2.join(',')}`
  }
  if (reqBody) {
    const bodyStyles = (JSON.parse(reqBody).blocks || []).filter(b => b.items && b.ordered).map(b => JSON.stringify(b.style))
    console.log('request body list styles:', bodyStyles.join(' '))
  }
  console.log(`${pass ? 'PASS' : 'FAIL'}  UI list style save  ${info}`)
  console.log(`${errors.length === 0 ? 'PASS' : 'FAIL'}  no pageerror  ${errors.slice(0, 2).join(' | ')}`)
  await browser.close()
  if (!pass || errors.length) process.exit(1)
}
main().catch(e => { console.error('E2E ERROR', e); process.exit(2) })
