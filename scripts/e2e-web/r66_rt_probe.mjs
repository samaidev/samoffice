// round66 探针 B：Excel 边框色保存往返（用户报告"调边框色后首行首列最外围边框消失"）。
// 流程：r61.xlsx → 框选 A1:D3 → 边框色红 → Ctrl+S 下载 → __setFileForTest 重开 →
//   检查首行上边框/首列左边框 computed 颜色 = 红（往返不丢）。
// 前置：bash scripts/e2e-web/_rebuild.sh；node scripts/e2e-web/r66_rt_probe.mjs
import { chromium } from 'playwright'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.resolve(__dirname, '../../frontend/dist-web')
const FIXTURES = path.resolve(__dirname, 'fixtures')
const SHOTS = path.resolve(__dirname, 'r66-shots')
fs.mkdirSync(SHOTS, { recursive: true })
const PORT = 8832

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.xlsx': 'application/octet-stream' }
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, `http://x`).pathname)
  let file = p.startsWith('/fixtures/') ? path.join(FIXTURES, p.slice('/fixtures/'.length)) : path.join(DIST, p)
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html')
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
})
await new Promise(r => server.listen(PORT, r))

const browser = await chromium.launch()
const page = await (await browser.newContext()).newPage()
page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 200)))
page.setDefaultTimeout(25000)
const results = []
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  | ' + detail : ''}`) }

try {
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-testid="mode-badge"]')
  await page.evaluate(async () => {
    const buf = await (await fetch('/fixtures/r61.xlsx')).arrayBuffer()
    await window.__setFileForTest(new File([buf], 'r61.xlsx'))
  })
  await page.waitForSelector('td[data-cell="0-0"]')
  await page.waitForTimeout(800)

  // 框选 A1:D3 → 边框色红
  await page.locator('td[data-cell="0-0"]').dragTo(page.locator('td[data-cell="2-3"]'))
  await page.waitForTimeout(300)
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'))
    const b = btns.find(x => (x.textContent || '').includes('🎨'))
    if (b) b.click()
  })
  await page.waitForTimeout(300)
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'))
    const b = btns.find(x => (x.textContent || '').includes('边框色') || /Border\s*Color/i.test(x.textContent || ''))
    if (b) b.click()
  })
  await page.waitForTimeout(200)
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'))
    const b = btns.find(x => (x.title || '') === '#ef4444')
    if (b) b.click()
  })
  await page.waitForTimeout(400)

  // Ctrl+S 下载
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.keyboard.press('Control+s'),
  ])
  const savedPath = path.join(SHOTS, 'r66-border-saved.xlsx')
  await download.saveAs(savedPath)
  ok('Ctrl+S 下载 xlsx', fs.statSync(savedPath).size > 5000, `${fs.statSync(savedPath).size} bytes`)

  // 检查保存的 styles.xml 边框定义（首行首列的样式边框四边是否带红）
  const AdmZip = null // 不引依赖 —— 用 Go/Python 均可；这里用 unzip 命令
  const { execSync } = await import('node:child_process')
  const stylesXml = execSync(`cd ${SHOTS} && unzip -p r66-border-saved.xlsx xl/styles.xml`, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })
  const borderNodes = stylesXml.match(/<border[ >][\s\S]*?<\/border>/g) || []
  const hasRedBorder = borderNodes.some(bd => /ef4444|FFEF4444/i.test(bd))
  const allSides = borderNodes.filter(bd => /ef4444/i.test(bd) && /left[^>]*style/.test(bd) && /top[^>]*style/.test(bd) && /right[^>]*style/.test(bd) && /bottom[^>]*style/.test(bd))
  ok('styles.xml 存在红色边框定义', hasRedBorder, `borders=${borderNodes.length}`)
  ok('红边框四边齐全（left/top/right/bottom 全带样式）', allSides.length > 0, `fourSide=${allSides.length}`)

  // 重开（__setFileForTest）→ 检查首行/首列外围边框颜色
  await page.evaluate(async (bytes) => {
    const buf = new Uint8Array(bytes).buffer
    await window.__setFileForTest(new File([buf], 'r66-border-saved.xlsx'))
  }, [...fs.readFileSync(savedPath)])
  await page.waitForSelector('td[data-cell="0-0"]')
  await page.waitForTimeout(900)
  const edge = await page.evaluate(() => {
    const probe = (sel, prop) => {
      const el = document.querySelector(sel)
      if (!el) return null
      const cs = getComputedStyle(el)
      return { w: cs.getPropertyValue(`border-${prop}-width`).trim(), c: cs.getPropertyValue(`border-${prop}-color`).trim() }
    }
    return {
      a1Top: probe('td[data-cell="0-0"]', 'top'),
      a1Left: probe('td[data-cell="0-0"]', 'left'),
      a1Right: probe('td[data-cell="0-3"]', 'right'),
      d3Bot: probe('td[data-cell="2-3"]', 'bottom'),
      inner: probe('td[data-cell="1-1"]', 'top'),
    }
  })
  const red = (v) => /239, 68, 68/i.test(v || '')
  ok('重开后 A1 上边框（首行外围）=红', red(edge.a1Top?.c), JSON.stringify(edge.a1Top))
  ok('重开后 A1 左边框（首列外围）=红', red(edge.a1Left?.c), JSON.stringify(edge.a1Left))
  ok('重开后首行右端右边框=红', red(edge.a1Right?.c), JSON.stringify(edge.a1Right))
  ok('重开后末行底边框=红', red(edge.d3Bot?.c), JSON.stringify(edge.d3Bot))
  ok('重开后内部格边框=红', red(edge.inner?.c), JSON.stringify(edge.inner))
} catch (e) {
  console.log('ERROR', String(e).slice(0, 400))
} finally {
  await browser.close()
  server.close()
}
const failed = results.filter(r => !r.pass).length
console.log(failed === 0 ? `\n${results.length}/${results.length} PASS` : `\n${results.length - failed}/${results.length} PASS, ${failed} FAIL`)
process.exit(failed === 0 ? 0 : 1)
