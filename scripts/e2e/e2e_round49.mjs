// e2e_round49.mjs — 查找栏崩溃修复验证（v0.7.29 用户报错复现）
// 报错：window.error: TypeError: Cannot read properties of undefined (reading 'search$')
// 根因：查找栏 ↑/↓ 按钮 onClick={nextMatch/prevMatch} 把 MouseEvent 当 editor view
//       传入 → view.state undefined → PluginKey.getState(undefined) 崩溃。
// 验证：Ctrl+F 打开 → 输入关键词查找 → 点 ↑↓ 多次 → 替换 → ✕ 关闭，
//       全程无 pageerror / window error，且计数与高亮正确。
import { chromium } from 'playwright'
import { mkdirSync } from 'fs'

const BASE = 'http://127.0.0.1:18400'
const SHOTS = '/home/z/my-project/samoffice/scripts/e2e/round49-shots'
mkdirSync(SHOTS, { recursive: true })
const results = []
const ok = (name, pass, info = '') => results.push([name, !!pass, String(info).slice(0, 140)])

async function main() {
  const browser = await chromium.launch({ args: ['--no-sandbox'] })
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } })
  const pageErrors = []
  page.on('pageerror', e => pageErrors.push(e.message))
  // window.onerror 兜底（用户报错走的就是 window.error）
  await page.addInitScript(() => {
    window.__winErrors = []
    window.addEventListener('error', (e) => { window.__winErrors.push(String(e.message || e)) })
  })

  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(1500)
  await page.evaluate(() => { localStorage.setItem('samoffice_lang', 'zh') })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)

  // 注入含多次重复词的文档
  await page.evaluate(() => {
    const mk = (t) => ({ inline: [{ content: t }], style: '', align: '' })
    window.__setDocForTest({
      blocks: [
        mk('节能收益分为节能客户收益和能源公司收益'),
        mk('节能率影响节能收益的分配'),
        mk('能源公司要求的回报率'),
      ],
    })
  })
  await page.waitForSelector('.ProseMirror', { timeout: 15000 })
  await page.waitForTimeout(600)

  // ---------- 1) Ctrl+F 打开查找栏 ----------
  await page.locator('.ProseMirror').click()
  await page.keyboard.press('Control+f')
  await page.waitForTimeout(400)
  const bar = page.locator('input[placeholder*="查找"], input[placeholder*="Find"], input[placeholder*="搜索"]').first()
  const barCount = await page.locator('.animate-fade-in input').count()
  ok('Ctrl+F 打开查找栏', barCount > 0, `inputs=${barCount}`)

  // ---------- 2) 输入关键词查找（3 处"节能"…先查"收益"，出现于第1、2段共3次） ----------
  const searchInput = page.locator('.animate-fade-in input').first()
  await searchInput.fill('收益')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(500)
  const highlighted = await page.locator('.search-match, .search-match-active').count()
  ok('查找高亮匹配', highlighted >= 3, `matches=${highlighted}`)

  // ---------- 3) 核心回归：点 ↑ / ↓ 各两次（旧版在此抛 search$ 崩溃） ----------
  const upBtn = page.locator('button:has-text("↑")')
  const downBtn = page.locator('button:has-text("↓")')
  await downBtn.click(); await page.waitForTimeout(200)
  await downBtn.click(); await page.waitForTimeout(200)
  await upBtn.click(); await page.waitForTimeout(200)
  await upBtn.click(); await page.waitForTimeout(200)
  const errsAfterNav = await page.evaluate(() => window.__winErrors || [])
  ok('↑↓ 导航无崩溃', pageErrors.length === 0 && errsAfterNav.length === 0,
    `pageerror=${JSON.stringify(pageErrors.slice(0, 1))} win=${JSON.stringify(errsAfterNav.slice(0, 1))}`)

  // 激活项计数文案（n/m 格式）
  const counter = await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll('span')).find(s => /^\d+\/\d+$/.test((s.textContent || '').trim()))
    return el ? el.textContent.trim() : ''
  })
  ok('匹配计数显示', /^\d+\/\d+$/.test(counter), counter)

  // ---------- 4) 替换全部 ----------
  const replaceInput = page.locator('.animate-fade-in input').nth(1)
  await replaceInput.fill('效益')
  await page.locator('button:has-text("全部替换")').click()
  await page.waitForTimeout(500)
  const textAfter = await page.locator('.ProseMirror').innerText()
  ok('全部替换生效', !textAfter.includes('收益') && textAfter.includes('效益'), textAfter.slice(0, 40))

  // ---------- 5) ✕ 关闭（旧版 viewRef.current! 也可能空指针） ----------
  await page.locator('button:has-text("✕")').click()
  await page.waitForTimeout(400)
  const errsAfterClose = await page.evaluate(() => window.__winErrors || [])
  const barGone = await page.locator('.animate-fade-in input').count()
  ok('✕ 关闭无崩溃', pageErrors.length === 0 && errsAfterClose.length === 0 && barGone === 0,
    `win=${JSON.stringify(errsAfterClose.slice(0, 1))} bar=${barGone}`)

  // ---------- 6) 再次打开再关闭（覆盖重复开关路径） ----------
  // ✕ 点击后焦点在按钮上，编辑器 keymap 收不到 Ctrl+F —— 先点回编辑器再按
  await page.locator('.ProseMirror').click()
  await page.waitForTimeout(200)
  await page.keyboard.press('Control+f')
  await page.waitForTimeout(500)
  ok('再次打开查找栏', await page.locator('.animate-fade-in input').count() > 0, 'bar not reopened')
  await searchInput.fill('节能')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(300)
  await page.locator('button:has-text("↓")').click()
  await page.waitForTimeout(200)
  await page.locator('button:has-text("✕")').click()
  await page.waitForTimeout(300)
  const errsFinal = await page.evaluate(() => window.__winErrors || [])
  ok('重复开关无崩溃', pageErrors.length === 0 && errsFinal.length === 0,
    `pageerror=${JSON.stringify(pageErrors.slice(0, 2))} win=${JSON.stringify(errsFinal.slice(0, 2))}`)

  await page.screenshot({ path: `${SHOTS}/final.png` })

  console.log('\n=== round49 E2E 结果 ===')
  let fail = 0
  for (const [name, pass, info] of results) {
    console.log(`${pass ? '✓' : '✗'} ${name}${pass ? '' : ' —— ' + info}`)
    if (!pass) fail++
  }
  if (pageErrors.length) console.log('pageerror:', pageErrors.slice(0, 3))
  console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}`)
  await browser.close()
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(e => { console.error(e); process.exit(2) })
