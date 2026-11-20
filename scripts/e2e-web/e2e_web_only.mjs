// SamOffice 形态3 端到端验证（浏览器纯静态构建 dist-web）
//
// 前置：./scripts/build-web.sh   （产物 frontend/dist-web/）
// 跑法：node scripts/e2e-web/e2e_web_only.mjs
//
// 5 项验证（模拟真实用户链路，全部走 WasmBackend 真实代码路径）：
//   1. mode 徽标 = wasm
//   2. 徽标文案 = 浏览器内 / In-browser
//   3. 打开 docx（16k 字中文）→ 解析完整
//   4. 编辑 → 导出 docx → 合法 zip（PK 魔数）
//   5. 打开 xlsx（complex.xlsx）→ 表格原生读取（字节直通）
//   6. 导出 PDF → samoffice-pdf.wasm 懒加载触发 + 合法 %PDF
//
// 结果写 scripts/e2e-web/results.json；退出码 0=全过。
import { chromium } from 'playwright'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.resolve(__dirname, '../../frontend/dist-web')
const FIXTURES = path.resolve(__dirname, 'fixtures')
const PORT = 8791

const results = []
const ok = (name, pass, detail = '') => {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  | ' + detail : ''}`)
}

// 静态服务器：dist-web + /fixtures/*（.wasm 必须给 application/wasm）
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.json': 'application/json',
  '.md': 'text/markdown; charset=utf-8',
  '.xlsx': 'application/octet-stream', '.docx': 'application/octet-stream',
}
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  let file = path.join(DIST, p)
  if (p.startsWith('/fixtures/')) file = path.join(FIXTURES, p.slice('/fixtures/'.length))
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html')
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
})
await new Promise(r => server.listen(PORT, r))
console.log(`serving ${DIST} on :${PORT}`)

const browser = await chromium.launch()
const ctx = await browser.newContext({ acceptDownloads: true })
const page = await ctx.newPage()
page.setDefaultTimeout(90000)

// 拉字节 → File → 直传 __setFileForTest（真实 uploadFile→openResult 链路）
async function openFile(url, name) {
  await page.evaluate(async ({ url, name }) => {
    const buf = await (await fetch(url)).arrayBuffer()
    await window.__setFileForTest(new File([buf], name))
  }, { url, name })
}

try {
  // 1+2) mode 徽标
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' })
  await page.waitForSelector('[data-testid="mode-badge"]')
  const badgeMode = await page.getAttribute('[data-testid="mode-badge"]', 'data-mode')
  const badgeText = ((await page.textContent('[data-testid="mode-badge"]')) || '').trim()
  ok('mode徽标=wasm', badgeMode === 'wasm', `mode=${badgeMode}`)
  ok('徽标文案=浏览器内', /浏览器内|In-browser/.test(badgeText), badgeText)

  // 3) 打开 docx（16k 字中文，走 wasm parse）
  await openFile('/fixtures/sample.docx', 'sample.docx')
  await page.waitForSelector('.ProseMirror', { timeout: 90000 })
  await page.waitForTimeout(1000)
  const chars = await page.evaluate(() => (document.querySelector('.ProseMirror')?.textContent || '').length)
  ok('docx解析(16k字)', chars > 15000, `chars=${chars}`)

  // 4) 编辑 → 导出 docx（主模块内存生成，浏览器下载）
  await page.click('.ProseMirror')
  await page.keyboard.type('形态3E2E编辑标记')
  const dl1 = page.waitForEvent('download', { timeout: 180000 })
  await page.evaluate(() => window.__exportForTest('docx'))
  const d1 = await dl1
  const b1 = fs.readFileSync(await d1.path())
  const outDir = path.join(__dirname, 'out')
  fs.mkdirSync(outDir, { recursive: true })
  fs.copyFileSync(await d1.path(), path.join(outDir, 'exported.docx'))
  // fixture 段落高度重复 → deflate 压缩比极高，16k 字可压到 ~5KB；PK 魔数即容器合法性
  const zipOK = b1.length > 2000 && b1[0] === 0x50 && b1[1] === 0x4b
  ok('导出docx合法zip', zipOK, `size=${b1.length} magic=${b1.subarray(0, 2).toString('ascii')}`)

  // 5) 导出 PDF（懒加载子模块：导出前 samofficePdf 未注册，点击后才拉 wasm）。
  //    注意：导出走“当前文档 state”——必须在 docx 打开状态下导出（真实用户操作序），
  //    若先开表格再导出，导的是空文档骨架（App 既有语义，非 bug）。
  let lazyFetched = false
  page.on('request', req => { if (req.url().includes('samoffice-pdf.wasm')) lazyFetched = true })
  const pdfLoadedBefore = await page.evaluate(() => !!window.samofficePdf)
  const dl2 = page.waitForEvent('download', { timeout: 300000 })
  await page.evaluate(() => window.__exportForTest('pdf'))
  const d2 = await dl2
  const b2 = fs.readFileSync(await d2.path())
  fs.copyFileSync(await d2.path(), path.join(outDir, 'exported.pdf'))
  // gopdf 只嵌入用到的字形子集（非全量 15MB），16k 字中文 PDF ~190KB 属正常
  ok('PDF懒加载触发', lazyFetched && !pdfLoadedBefore, `before=${pdfLoadedBefore} fetched=${lazyFetched}`)
  const pdfOK = b2.length > 100000 && b2.subarray(0, 4).toString('ascii') === '%PDF'
  ok('导出PDF合法且含内容', pdfOK, `size=${b2.length} magic=${b2.subarray(0, 4).toString('ascii')}`)

  // 6) 打开 xlsx（complex.xlsx 在 dist-web 根，来自 frontend/public/）→ 字节直通原生读取
  await openFile('/complex.xlsx', 'complex.xlsx')
  await page.waitForTimeout(2000)
  const xlsxDetail = await page.evaluate(() => ({
    tables: document.querySelectorAll('table').length,
    textLen: document.body.innerText.length,
  }))
  ok('xlsx原生读取', xlsxDetail.tables > 0 && xlsxDetail.textLen > 200,
    `tables=${xlsxDetail.tables} textLen=${xlsxDetail.textLen}`)
} catch (e) {
  ok('异常中断', false, e.message)
  try { await page.screenshot({ path: path.join(__dirname, 'fail-shot.png') }) } catch {}
} finally {
  fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify(results, null, 2))
  const fails = results.filter(r => !r.pass).length
  console.log(`\n=== ${results.length - fails}/${results.length} PASS ===`)
  await browser.close().catch(() => {})
  server.close()
  process.exit(fails ? 1 : 0)
}
