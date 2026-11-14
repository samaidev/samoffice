/** 视觉验证：截取主界面头部 + API 弹窗截图 */
import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { join, extname } from 'node:path'
import { chromium } from 'playwright'

const DIST = join(process.cwd(), 'frontend', 'dist')
const PORT = 8168
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.md': 'text/markdown; charset=utf-8' }
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.addInitScript(() => {
    window.go = { main: { App: {
      GetStartupArgs: async () => [],
      OpenFile: async () => ({ document: { meta: {}, blocks: [{ inline: [{ content: '中文  空格  占位测试' }] }] }, warnings: [], path: '', rawContent: '' }),
      ReadFile: async () => '',
      HTTPPort: async () => 53721,
      LogError: async () => {}, Log: async () => {},
    } } }
    window.runtime = { Events: { Emit: () => {}, On: () => {} }, Log: () => {} }
  })
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  await page.screenshot({ path: '/tmp/render/header.png', clip: { x: 0, y: 0, width: 1440, height: 90 } })
  await page.click('[data-testid="api-doc-btn"]')
  await page.waitForSelector('[data-testid="api-doc-dialog"]', { timeout: 8000 })
  await page.waitForTimeout(600)
  await page.screenshot({ path: '/tmp/render/api-dialog.png' })
  await browser.close()
  server.close()
  console.log('shots saved')
}
main().catch(e => { console.error(e); server.close(); process.exit(1) })
