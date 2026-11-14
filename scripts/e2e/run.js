// 简化 E2E：单独跑，避免长链崩溃
const { firefox, devices } = require('playwright')
const fs = require('fs')
const path = require('path')

const BASE_URL = 'http://127.0.0.1:19000'
const SHOTS_DIR = path.join(__dirname, 'screenshots')
fs.mkdirSync(SHOTS_DIR, { recursive: true })

const results = []
function log(name, status, details = '') {
  const icon = status === 'PASS' ? '✓' : status === 'FAIL' ? '✗' : '→'
  console.log(`  ${icon} [${status}] ${name}${details ? ' - ' + details : ''}`)
  results.push({ name, status, details })
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(SHOTS_DIR, name + '.png'), fullPage: false })
}

async function safe(fn, label) {
  try { await fn() }
  catch (e) { log(label, 'FAIL', e.message.slice(0, 100)) }
}

async function runDesktop() {
  console.log('\n=== Desktop Tests (1280x800) ===')
  const browser = await firefox.launch({
    args: [
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-sync',
      '--no-first-run',
      '--memory-pressure-off',
    ]
  })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await ctx.newPage()
  const consoleErrors = []
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })

  await safe(async () => {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15000 })
    const title = await page.title()
    log('首页加载', title.includes('SamOffice') ? 'PASS' : 'FAIL', `title="${title}"`)
    await shot(page, '01-home')
  }, '首页加载')

  await safe(async () => {
    const menuButtons = await page.locator('header button').count()
    log('顶栏菜单', menuButtons >= 4 ? 'PASS' : 'FAIL', `${menuButtons} 个按钮`)
  }, '顶栏菜单')

  await safe(async () => {
    await page.click('button:has-text("表格")')
    await page.waitForTimeout(400)
    const visible = await page.locator('table').isVisible()
    log('切换到表格', visible ? 'PASS' : 'FAIL')
    await shot(page, '02-spreadsheet')
  }, '表格切换')

  await safe(async () => {
    await page.click('button:has-text("演示")')
    await page.waitForTimeout(400)
    const visible = await page.locator('input[placeholder*="标题"]').first().isVisible()
    log('切换到演示', visible ? 'PASS' : 'FAIL')
    await shot(page, '03-slide')
  }, '演示切换')

  await safe(async () => {
    await page.click('button:has-text("文档")')
    await page.waitForTimeout(400)
    const visible = await page.locator('.ProseMirror').isVisible()
    log('切换回文档', visible ? 'PASS' : 'FAIL')
  }, '文档切换')

  await safe(async () => {
    const count = await page.locator('.toolbar-btn').count()
    log('工具栏按钮', count >= 10 ? 'PASS' : 'FAIL', `${count} 个`)
  }, '工具栏')

  await safe(async () => {
    // 切换到英文进行拼写检查
    await page.selectOption('select', 'en')
    await page.waitForTimeout(300)
    await page.click('.ProseMirror')
    await page.keyboard.type('Hello SamOffice misspellled worrd')
    await page.waitForTimeout(1500)
    const text = await page.locator('.ProseMirror').textContent()
    log('输入文本', text.includes('Hello') ? 'PASS' : 'FAIL', `len=${text.length}`)
    await shot(page, '04-typed-text')
  }, '输入文本')

  await safe(async () => {
    // 等待 spell-error 元素出现（防抖 + 异步检查）
    await page.waitForTimeout(1500)
    // ProseMirror 可能把 inline decoration 拆成多个 span，用 [class*="spell"] 匹配
    const errCount = await page.locator('.ProseMirror span').evaluateAll(els => {
      return els.filter(el => el.className.includes('spell-error')).length
    })
    log('拼写错误标记', errCount >= 1 ? 'PASS' : 'FAIL', `${errCount} 个 span`)
    await shot(page, '05-spell-check')
  }, '拼写检查')

  await safe(async () => {
    await page.click('.ProseMirror')
    // 选中部分文本（用键盘）
    await page.keyboard.press('Home')
    await page.waitForTimeout(100)
    // Shift+End 选中当前行
    await page.keyboard.press('Shift+End')
    await page.waitForTimeout(300)
    await page.click('.toolbar-btn[title*="加粗"]')
    await page.waitForTimeout(500)
    const active = await page.locator('.toolbar-btn[title*="加粗"]').evaluate(el => el.classList.contains('active'))
    // 也检查 strong 标签
    const strongCount = await page.locator('.ProseMirror strong').count()
    log('加粗按钮激活', active || strongCount > 0 ? 'PASS' : 'FAIL', `active=${active}, strong=${strongCount}`)
    await shot(page, '06-bold-active')
  }, '加粗激活')

  await safe(async () => {
    await page.selectOption('select', 'zh')
    await page.waitForTimeout(300)
    await page.click('.ProseMirror')
    await page.keyboard.press('Control+a')
    await page.keyboard.type('我们在北京编辑文档')
    await page.waitForTimeout(1500)
    const errCount = await page.locator('.spell-error').count()
    log('中文拼写检查', errCount === 0 ? 'PASS' : 'FAIL', `${errCount} 个误报`)
    await shot(page, '07-chinese')
  }, '中文测试')

  await safe(async () => {
    const r = await page.evaluate(async () => {
      const r = await fetch('/api/health')
      return await r.json()
    })
    log('API health', r.status === 'ok' ? 'PASS' : 'FAIL')
  }, 'API health')

  await safe(async () => {
    const r = await page.evaluate(async () => {
      const r = await fetch('/api/dict/check?text=helo%20worrd&lang=en')
      return await r.json()
    })
    log('API 拼写检查', r.errors?.length === 2 ? 'PASS' : 'FAIL', `${r.errors?.length} 错误`)
  }, 'API 拼写')

  await safe(async () => {
    const r = await page.evaluate(async () => {
      const r = await fetch('/api/dict/check?text=' + encodeURIComponent('definately recieve') + '&lang=en')
      return await r.json()
    })
    const sugs = r.errors?.flatMap(e => e.suggest || []) || []
    const ok = sugs.includes('definitely') && sugs.includes('receive')
    log('aff 派生纠错', ok ? 'PASS' : 'FAIL', sugs.slice(0, 5).join(','))
  }, 'aff 派生')

  await safe(async () => {
    const r = await page.evaluate(async () => {
      const r = await fetch('/api/dict/check?text=' + encodeURIComponent('我们在北京编辑文档') + '&lang=zh')
      return await r.json()
    })
    log('中文 API', r.errors?.length === 0 ? 'PASS' : 'FAIL', `${r.errors?.length} 误报`)
  }, '中文 API')

  await safe(async () => {
    await page.evaluate(async () => {
      await fetch('/api/dict/learn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word: 'e2etestword', lang: 'en', source: 'manual' })
      })
    })
    const r = await page.evaluate(async () => {
      const r = await fetch('/api/dict/check?text=e2etestword&lang=en')
      return await r.json()
    })
    log('用户词库学习', r.errors?.length === 0 ? 'PASS' : 'FAIL')
  }, '词库学习')

  await safe(async () => {
    const r = await page.evaluate(async () => {
      const r = await fetch('/api/doc/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meta: { title: 'E2E' }, blocks: [{ inline: [{ content: 'test' }], style: '', align: '' }] })
      })
      return { status: r.status, type: r.headers.get('content-type') }
    })
    log('docx 导出', r.status === 200 && r.type.includes('wordprocessingml') ? 'PASS' : 'FAIL', `${r.status}`)
  }, 'docx 导出')

  await safe(async () => {
    const r = await page.evaluate(async () => {
      const r = await fetch('/api/doc/export-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meta: { title: 'E2E' }, blocks: [{ inline: [{ content: 'test' }], style: '', align: '' }] })
      })
      return { status: r.status, type: r.headers.get('content-type') }
    })
    log('PDF 导出', r.status === 200 && r.type === 'application/pdf' ? 'PASS' : 'FAIL', `${r.status}`)
  }, 'PDF 导出')

  log('无 Console 错误', consoleErrors.length === 0 ? 'PASS' : 'FAIL', consoleErrors.length > 0 ? consoleErrors[0].slice(0, 80) : '')

  await browser.close()
}

async function runMobile() {
  console.log('\n=== Mobile Tests (iPhone 13) ===')
  const browser = await firefox.launch({
    args: [
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-extensions',
      '--no-first-run',
      '--memory-pressure-off',
    ]
  })
  const ctx = await browser.newContext({ ...devices['iPhone 13'] })
  const page = await ctx.newPage()

  await safe(async () => {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15000 })
    const title = await page.title()
    log('移动端首页', title.includes('SamOffice') ? 'PASS' : 'FAIL')
    await shot(page, '08-mobile-home')
  }, '移动端首页')

  await safe(async () => {
    // 汉堡按钮（移动端）
    const btns = await page.locator('header button').count()
    log('移动端顶栏', btns >= 1 ? 'PASS' : 'FAIL', `${btns} 按钮`)
  }, '移动端顶栏')

  await safe(async () => {
    await page.locator('header button').first().click()
    await page.waitForTimeout(400)
    const visible = await page.locator('text=打开文件').first().isVisible()
    log('汉堡菜单展开', visible ? 'PASS' : 'FAIL')
    await shot(page, '09-mobile-menu')
  }, '汉堡菜单')

  await safe(async () => {
    await page.click('button:has-text("表格")')
    await page.waitForTimeout(400)
    const visible = await page.locator('table').isVisible()
    log('移动端表格', visible ? 'PASS' : 'FAIL')
    await shot(page, '10-mobile-spreadsheet')
  }, '移动端表格')

  await safe(async () => {
    await page.click('button:has-text("演示")')
    await page.waitForTimeout(400)
    const visible = await page.locator('input[placeholder*="标题"]').first().isVisible()
    log('移动端演示', visible ? 'PASS' : 'FAIL')
    await shot(page, '11-mobile-slide')
  }, '移动端演示')

  await safe(async () => {
    await page.click('button:has-text("文档")')
    await page.waitForTimeout(400)
    await page.click('.ProseMirror')
    await page.keyboard.type('移动端测试 mobile test')
    await page.waitForTimeout(500)
    const text = await page.locator('.ProseMirror').textContent()
    log('移动端输入', text.includes('移动端') ? 'PASS' : 'FAIL')
    await shot(page, '12-mobile-doc')
  }, '移动端输入')

  await browser.close()
}

async function main() {
  console.log(`SamOffice E2E Tests → ${BASE_URL}`)
  await runDesktop()
  await runMobile()

  const passed = results.filter(r => r.status === 'PASS').length
  const failed = results.filter(r => r.status === 'FAIL').length
  console.log('\n=== Summary ===')
  console.log(`  Total: ${results.length}`)
  console.log(`  PASS:  ${passed}`)
  console.log(`  FAIL:  ${failed}`)
  console.log(`  Pass rate: ${(passed / (passed + failed) * 100).toFixed(1)}%`)

  if (failed > 0) {
    console.log('\nFailed:')
    results.filter(r => r.status === 'FAIL').forEach(r => {
      console.log(`  ✗ ${r.name}: ${r.details}`)
    })
  }
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(e => { console.error('fatal:', e); process.exit(2) })
