/**
 * API 按钮端到端测试：
 * 1. 右上角「本地」徽章后存在 API 按钮
 * 2. 点击 → 弹窗打开，展示 MD 全文
 * 3. 自动复制到剪贴板，内容包含关键端点
 * 4. 「复制」按钮与关闭按钮可用
 *
 * 用法: node scripts/e2e/test_api_button.mjs
 */
import { createServer } from 'node:http'
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { join, extname } from 'node:path'
import { chromium } from 'playwright'

const DIST = join(process.cwd(), 'frontend', 'dist')
const PORT = 8167
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.md': 'text/markdown; charset=utf-8', '.json': 'application/json' }

const server = createServer((req, res) => {
  let p = req.url.split('?')[0]
  if (p === '/') p = '/index.html'
  const f = join(DIST, p)
  if (!existsSync(f)) { res.writeHead(404); res.end(); return }
  res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream' })
  res.end(readFileSync(f))
})

const main = async () => {
  server.listen(PORT, '127.0.0.1')
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] })
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', e => errs.push(String(e)))
  await page.addInitScript(() => {
    window.go = { main: { App: {
      GetStartupArgs: async () => [],
      OpenFile: async () => ({ document: { meta: {}, blocks: [] }, warnings: [], path: '', rawContent: '' }),
      ReadFile: async () => '',
      HTTPPort: async () => 53721,
      LogError: async () => {}, Log: async () => {},
    } } }
    window.runtime = { Events: { Emit: () => {}, On: () => {} }, Log: () => {} }
  })
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1000)

  // 1. API 按钮存在，且位于「本地」徽章之后
  const btnInfo = await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="api-doc-btn"]')
    const badge = document.querySelector('[data-testid="mode-badge"]')
    if (!btn || !badge) return { exists: !!btn, afterBadge: false }
    // 比较 DOM 顺序
    return { exists: true, afterBadge: badge.compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_FOLLOWING }
  })

  // 2. 点击 → 弹窗
  await page.click('[data-testid="api-doc-btn"]')
  await page.waitForSelector('[data-testid="api-doc-dialog"]', { timeout: 8000 })
  await page.waitForTimeout(600)

  const dialogInfo = await page.evaluate(() => {
    const dlg = document.querySelector('[data-testid="api-doc-dialog"]')
    const pre = dlg?.querySelector('pre')
    const text = pre ? pre.textContent || '' : ''
    return {
      open: !!dlg,
      hasBase: text.includes('BASE = http://127.0.0.1:53721'),
      hasLibDoc: text.includes('/api/lib/doc/create'),
      hasLibPpt: text.includes('/api/lib/ppt/create'),
      hasSave: text.includes('/api/doc/save'),
      hasUdm: text.includes('UDM'),
      hasPendingOpen: text.includes('pending_open.txt'),
      len: text.length,
    }
  })

  // 3. 剪贴板内容（已授权 clipboard-read）
  let clipboard = ''
  try { clipboard = await page.evaluate(() => navigator.clipboard.readText()) } catch (e) { clipboard = `ERR:${e}` }
  const clipOk = clipboard.includes('/api/lib/doc/create') && clipboard.includes('SamOffice')

  // 4. 复制按钮 + 关闭
  await page.click('[data-testid="api-doc-dialog"] button:has-text("复制"), [data-testid="api-doc-dialog"] button:has-text("Copy")')
  await page.waitForTimeout(300)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  const closed = await page.evaluate(() => !document.querySelector('[data-testid="api-doc-dialog"]'))

  const checks = {
    buttonExists: btnInfo.exists && btnInfo.afterBadge,
    dialogOpen: dialogInfo.open,
    liveBaseShown: dialogInfo.hasBase,
    docEndpoints: dialogInfo.hasLibDoc && dialogInfo.hasLibPpt && dialogInfo.hasSave,
    udmSchema: dialogInfo.hasUdm,
    pendingOpenDoc: dialogInfo.hasPendingOpen,
    clipboardCopied: clipOk,
    copyAndClose: closed,
    noErrors: errs.length === 0,
  }
  console.log('button:', JSON.stringify(btnInfo))
  console.log('dialog:', JSON.stringify(dialogInfo))
  console.log('clipboard length:', clipboard.length, 'ok:', clipOk)
  console.log('checks:', JSON.stringify(checks))
  console.log('ERRORS:', errs.slice(0, 3))

  const passed = Object.values(checks).every(Boolean)
  console.log(passed ? 'PASSED' : 'FAILED')
  writeFileSync(join(process.cwd(), 'scripts', 'e2e', 'api_button_result.json'), JSON.stringify({ btnInfo, dialogInfo, checks, clipLen: clipboard.length, errs: errs.slice(0, 3) }, null, 2))
  await browser.close()
  server.close()
  process.exit(passed ? 0 : 1)
}

main().catch(e => { console.error(e); server.close(); process.exit(1) })
