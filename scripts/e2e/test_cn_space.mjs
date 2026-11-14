/**
 * 中文空格渲染复现测试：
 * 注入含连续空格/run边界空格的 UDM，测量各段 Range 宽度，
 * 验证空格在视觉上是否逐个占位（对齐 MS Word）。
 *
 * 用法: node scripts/e2e/test_cn_space.mjs
 */
import { createServer } from 'node:http'
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { join, extname } from 'node:path'
import { chromium } from 'playwright'

const DIST = join(process.cwd(), 'frontend', 'dist')
const PORT = 8166
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json' }

const server = createServer((req, res) => {
  let p = req.url.split('?')[0]
  if (p === '/') p = '/index.html'
  const f = join(DIST, p)
  if (!existsSync(f)) { res.writeHead(404); res.end(); return }
  res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream' })
  res.end(readFileSync(f))
})

const DOC = {
  meta: {},
  blocks: [
    { inline: [{ content: '中 文' }] },          // 1 个半角空格
    { inline: [{ content: '中  文' }] },         // 2 个连续空格
    { inline: [{ content: '中   文' }] },        // 3 个连续空格
    { inline: [{ content: '开始  中间   结尾' }] },
    { inline: [{ content: '全角空\u3000格' }] }, // 全角空格
    { inline: [{ content: '粗体结尾空 ', bold: true }, { content: ' 普通开头空' }] }, // run 边界双空格
    { inline: [{ content: '行尾空格 ' }] },      // 行尾空格
  ],
}

const main = async () => {
  server.listen(PORT, '127.0.0.1')
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errs = []
  page.on('pageerror', e => errs.push(String(e)))
  await page.addInitScript((doc) => {
    window.go = { main: { App: {
      GetStartupArgs: async () => ['C:/test/cn_space.docx'],
      OpenFile: async () => ({ document: doc, warnings: [], path: 'C:/test/cn_space.docx', rawContent: '' }),
      ReadFile: async () => '',
      LogError: async () => {}, Log: async () => {},
    } } }
    window.runtime = { Events: { Emit: () => {}, On: () => {} }, Log: () => {} }
  }, DOC)
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.ProseMirror', { timeout: 15000 })
  await page.waitForTimeout(800)

  const result = await page.evaluate(() => {
    const out = { whiteSpace: '', paras: [] }
    const ed = document.querySelector('.ProseMirror')
    out.whiteSpace = getComputedStyle(ed).whiteSpace
    const ps = Array.from(ed.querySelectorAll('p'))
    ps.forEach((p) => {
      const text = p.textContent
      if (!text) return
      const range = document.createRange()
      range.selectNodeContents(p)
      const rect = range.getBoundingClientRect()
      out.paras.push({ text, width: Math.round(rect.width * 10) / 10 })
    })
    return out
  })

  console.log('computed white-space:', JSON.stringify(result.whiteSpace))
  result.paras.forEach(p => console.log(`  [${p.text.replace(/ /g, '·').replace(/\u3000/g, '＿')}] width=${p.width}px`))

  // 判定：2 空格段必须比 1 空格段宽，3 空格段更宽；run 边界双空格同样占位
  const w = t => (result.paras.find(p => p.text === t) || {}).width
  const w1 = w('中 文'), w2 = w('中  文'), w3 = w('中   文')
  const checks = {
    whiteSpacePre: /pre-wrap|break-spaces/.test(result.whiteSpace),
    twoWiderThanOne: typeof w2 === 'number' && typeof w1 === 'number' && w2 > w1 + 1,
    threeWiderThanTwo: typeof w3 === 'number' && typeof w2 === 'number' && w3 > w2 + 1,
  }
  console.log('checks:', JSON.stringify(checks))
  console.log('ERRORS:', errs.slice(0, 3))
  const passed = checks.whiteSpacePre && checks.twoWiderThanOne && checks.threeWiderThanTwo
  console.log(passed ? 'PASSED' : 'FAILED')

  writeFileSync(join(process.cwd(), 'scripts', 'e2e', 'cn_space_result.json'), JSON.stringify({ ...result, checks, passed }, null, 2))
  await browser.close()
  server.close()
  process.exit(passed ? 0 : 1)
}

main().catch(e => { console.error(e); server.close(); process.exit(1) })
