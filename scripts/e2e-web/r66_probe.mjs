// round66 探针：Excel 边框色修改后首行/首列最外围边框是否消失 + 打印预览图表。
// 问题1（用户报告）：选中区域设置边框色（setCellFmtRange({border:'thin',borderColor})）
//   后，第一行和第一列【最外围】的边框消失。
// 问题2（用户报告）：打印预览看不到图表/图片对象（round66 已加浮层渲染，验证）。
// 验证：
//   A. 打开 r61.xlsx（含图表）→ 全选 A1:D3 → 边框色面板 → 点一个色
//      → 检查第 0 行上边框、第 0 列左边框的 computed borderColor 仍为所设颜色（非 --color-border）
//   B. 同场景打开打印预览 → 检查预览 DOM 里出现 [data-chart-id] SVG（图表渲染进纸张）
// 前置：bash scripts/e2e-web/_rebuild.sh；node scripts/e2e-web/r66_probe.mjs
import { chromium } from 'playwright'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.resolve(__dirname, '../../frontend/dist-web')
const FIXTURES = path.resolve(__dirname, 'fixtures')
const PORT = 8827

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
page.setDefaultTimeout(20000)
const results = []
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  | ' + detail : ''}`) }

try {
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' })
  await page.waitForSelector('[data-testid="mode-badge"]')
  await page.evaluate(async () => {
    const buf = await (await fetch('/fixtures/r61.xlsx')).arrayBuffer()
    await window.__setFileForTest(new File([buf], 'r61.xlsx'))
  })
  await page.waitForSelector('td[data-cell="0-0"]')
  await page.waitForTimeout(800)

  // ===== A. 框选 A1:D3 → 边框色面板 → 点红色 =====
  await page.locator('td[data-cell="0-0"]').dragTo(page.locator('td[data-cell="2-3"]'))
  await page.waitForTimeout(300)
  // 打开颜色面板（字体色/填充色/边框色三模式）：找 🎨「颜色」RibbonButton
  // （RibbonButton 的 icon 是独立 span，textContent 形如 "🎨颜色"；兜底 title 含 颜色）
  const openedColor = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'))
    const b = btns.find(x => ((x.textContent || '') + (x.title || '')).includes('🎨') && (x.title || '').includes('颜色'))
      || btns.find(x => (x.textContent || '').includes('🎨'))
    if (b) { b.click(); return true }
    return false
  })
  ok('颜色面板已打开', openedColor)
  await page.waitForTimeout(300)
  // 切「边框色」模式
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'))
    const b = btns.find(x => (x.textContent || '').includes('边框色') || /Border\s*Color/i.test(x.textContent || ''))
    if (b) b.click()
  })
  await page.waitForTimeout(200)
  // 点红色 #ef4444
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'))
    const b = btns.find(x => (x.title || '') === '#ef4444')
    if (b) b.click()
  })
  await page.waitForTimeout(400)

  // 检查首行/首列最外围边框：td(0-0) 的 borderTop/borderLeft computed 颜色
  const edge = await page.evaluate(() => {
    const probe = (sel, prop) => {
      const el = document.querySelector(sel)
      if (!el) return null
      const cs = getComputedStyle(el)
      return { w: cs.getPropertyValue(`border-${prop}-width`).trim(), c: cs.getPropertyValue(`border-${prop}-color`).trim() }
    }
    return {
      topLeft: probe('td[data-cell="0-0"]', 'top'),
      topLeftL: probe('td[data-cell="0-0"]', 'left'),
      topRight: probe('td[data-cell="0-3"]', 'top'),
      botLeft: probe('td[data-cell="2-0"]', 'left'),
      inner: probe('td[data-cell="1-1"]', 'top'),
    }
  })
  ok('A1 上边框（首行外围）仍为设置色', /239, 68, 68|rgb\(239, 68, 68\)|#ef4444/i.test(edge.topLeft?.c || ''), JSON.stringify(edge.topLeft))
  ok('A1 左边框（首列外围）仍为设置色', /239, 68, 68|rgb\(239, 68, 68\)|#ef4444/i.test(edge.topLeftL?.c || ''), JSON.stringify(edge.topLeftL))
  ok('内部格边框为设置色（对照）', /239, 68, 68|rgb\(239, 68, 68\)|#ef4444/i.test(edge.inner?.c || ''), JSON.stringify(edge.inner))

  // ===== B. 打印预览含图表 =====
  // 先插入一个图表（round65 同款路径：框选 A1:D3 → 插入 tab → 图表 → 柱形图）
  await page.locator('td[data-cell="0-0"]').dragTo(page.locator('td[data-cell="2-3"]'))
  await page.waitForTimeout(300)
  await page.click('[data-testid="ribbon-tab-insert"]')
  await page.click('[data-testid="sheet-btn-chart"]')
  await page.waitForSelector('[data-testid="insert-chart-column"]')
  await page.click('[data-testid="insert-chart-column"]')
  await page.waitForSelector('svg[data-chart-id]', { state: 'attached', timeout: 15000 })
  await page.waitForTimeout(600)
  const chartsInEditor = await page.evaluate(() => document.querySelectorAll('svg[data-chart-id]').length)
  ok('图表已插入编辑视图', chartsInEditor > 0, `count=${chartsInEditor}`)
  // 先点网格区域取消选区，再点打印按钮
  await page.mouse.click(400, 400).catch(() => {})
  await page.waitForTimeout(200)
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'))
    const b = btns.find(x => (x.title || '').includes('打印') && (x.textContent || '').includes('打印'))
    if (b) { b.click(); return true }
    return false
  })
  await page.waitForTimeout(1200)
  const printState = await page.evaluate(() => {
    // PrintDialog 预览区：查 .print-paper 内是否有图表 SVG（ChartRenderer 的 svg 无 data-chart-id？
    // ChartRenderer 有 data-chart-id attr —— 查整个预览容器）
    const papers = document.querySelectorAll('.print-paper')
    const chartSvgs = document.querySelectorAll('.print-paper svg[data-chart-id], .print-paper [data-chart-id]')
    const imgs = document.querySelectorAll('.print-paper img')
    return { papers: papers.length, charts: chartSvgs.length, imgs: imgs.length }
  })
  ok('打印预览：纸张已渲染', printState.papers > 0, JSON.stringify(printState))
  ok('打印预览：图表出现在纸张上', printState.charts > 0, JSON.stringify(printState))
} catch (e) {
  console.log('ERROR', String(e).slice(0, 400))
} finally {
  await browser.close()
  server.close()
}
const failed = results.filter(r => !r.pass).length
console.log(failed === 0 ? `\n${results.length}/${results.length} PASS` : `\n${results.length - failed}/${results.length} PASS, ${failed} FAIL`)
process.exit(failed === 0 ? 0 : 1)
