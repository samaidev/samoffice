// round65 探针：Excel 图表标题/系列编辑（用户反馈第四项）。
// 复用 r61.xlsx（A1:D3 苹果/香蕉/Q1 表）→ 插入柱形图 → 验证：
//   1. 「编辑标题」面板：改文字/字号/颜色/斜体/位置 → SVG 生效
//   2. 「编辑系列」面板：改系列名/颜色 → 图例文字与柱色变化
//   3. 双击图表标题 → 切到「图表设计」选项卡
// 前置：bash scripts/e2e-web/_rebuild.sh；node scripts/e2e-web/r65_chart_probe.mjs
import { chromium } from 'playwright'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.resolve(__dirname, '../../frontend/dist-web')
const FIXTURES = path.resolve(__dirname, 'fixtures')
const PORT = 8822

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

const chartTexts = () => page.evaluate(() => Array.from(document.querySelectorAll('svg[data-chart-id] text')).map(t => t.textContent).join('|'))

try {
  // ============ 打开数据表（r61.xlsx：A1:D3 苹果/香蕉/Q1..Q4 表） ============
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' })
  await page.waitForSelector('[data-testid="mode-badge"]')
  await page.evaluate(async () => {
    const buf = await (await fetch('/fixtures/r61.xlsx')).arrayBuffer()
    await window.__setFileForTest(new File([buf], 'r61.xlsx'))
  })
  await page.waitForSelector('td[data-cell="0-0"]')
  await page.waitForTimeout(800)

  // ============ 框选 A1:D3 → 插入簇状柱形图 ============
  const bbox = async (sel) => {
    const el = await page.$(sel)
    if (!el) return null
    const b = await el.boundingBox()
    return b
  }
  const a1 = await bbox('td[data-cell="0-0"]')
  const d3 = await bbox('td[data-cell="2-3"]')
  if (!a1 || !d3) {
    ok('数据格定位（A1/D3）', false, `a1=${!!a1} d3=${!!d3}`)
  } else {
    await page.locator('td[data-cell="0-0"]').dragTo(page.locator('td[data-cell="2-3"]'))
    await page.waitForTimeout(200)
    await page.click('[data-testid="ribbon-tab-insert"]')
    await page.click('[data-testid="sheet-btn-chart"]')
    await page.waitForSelector('[data-testid="insert-chart-column"]')
    await page.click('[data-testid="insert-chart-column"]')
    await page.waitForSelector('[data-testid="pic-layer"] svg[data-chart-id]', { timeout: 15000 })
    await page.waitForTimeout(500)
    ok('图表已插入（浮层 SVG）', true)
  }

  // ============ 选中图表 → 图表设计选项卡 ============
  const chartBox = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="pic-layer"] [data-chart-id]')
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height }
  })
  if (!chartBox) {
    ok('选中图表 → 「图表设计」选项卡', false, 'chartBox null')
  } else {
    await page.mouse.click(Math.round(chartBox.x + chartBox.w / 2), Math.round(chartBox.y + chartBox.h / 2))
    await page.waitForTimeout(400)
    const onChartTab = await page.locator('[data-testid="ribbon-tab-chart"]').isVisible().catch(() => false)
    ok('选中图表 → 「图表设计」选项卡', onChartTab)

  // ===== 1. 编辑标题面板 =====
  await page.click('[data-testid="chart-menu-title-edit"]')
  await page.waitForTimeout(300)
  ok('「编辑标题」面板打开', await page.$('[data-testid="chart-title-text"]') !== null)

  await page.fill('[data-testid="chart-title-text"]', '2026年销量统计')
  await page.$eval('[data-testid="chart-title-text"]', el => el.blur())
  await page.waitForTimeout(300)
  await page.fill('[data-testid="chart-title-size"]', '18')
  await page.$eval('[data-testid="chart-title-size"]', el => el.blur())
  await page.waitForTimeout(200)
  await page.$eval('[data-testid="chart-title-color"]', el => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(el, '#e0115f')
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await page.waitForTimeout(300)
  await page.$eval('[data-testid="chart-title-italic"]', el => el.click())
  await page.waitForTimeout(300)
  await page.$eval('[data-testid="chart-title-pos"]', el => { el.value = 'lb'; el.dispatchEvent(new Event('change', { bubbles: true })) })
  await page.waitForTimeout(400)

  const titleState = await page.evaluate(() => {
    const svg = document.querySelector('[data-testid="pic-layer"] svg[data-chart-id]')
    if (!svg) return { found: false }
    const texts = Array.from(svg.querySelectorAll('text'))
    const t = texts.find(x => (x.textContent || '').includes('2026年销量统计'))
    if (!t) return { found: false, allText: texts.map(x => x.textContent).slice(0, 6) }
    return {
      found: true, size: t.getAttribute('font-size'), fill: t.getAttribute('fill'),
      weight: t.getAttribute('font-weight'), style: (t.getAttribute('style') || ''),
      x: t.getAttribute('x'), y: t.getAttribute('y'), H: svg.getAttribute('height'),
    }
  })
  ok('标题文字已更新（编辑内容生效）', titleState.found === true, JSON.stringify(titleState).slice(0, 160))
  ok('标题字号 18 生效', (titleState.size || '') === '18', 'size=' + titleState.size)
  ok('标题颜色 #e0115f 生效', String(titleState.fill || '').toLowerCase() === '#e0115f', 'fill=' + titleState.fill)
  ok('标题斜体生效', /italic/.test(titleState.style || ''), 'style=' + titleState.style)
  ok('标题位置左下生效（y 贴底）', titleState.found && Number(titleState.y) >= Number(titleState.H) - 40, `y=${titleState.y} H=${titleState.H}`)

  // ===== 2. 编辑系列面板 =====
  await page.click('[data-testid="chart-menu-series"]')
  await page.waitForTimeout(300)
  ok('「编辑系列」面板打开', await page.$('[data-testid="chart-series-name-0"]') !== null)
  await page.fill('[data-testid="chart-series-name-0"]', '上半年销量')
  await page.$eval('[data-testid="chart-series-name-0"]', el => el.blur())
  await page.waitForTimeout(300)
  await page.$eval('[data-testid="chart-series-color-0"]', el => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(el, '#ed7d31')
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await page.waitForTimeout(400)

  const seriesState = await page.evaluate(() => {
    const svg = document.querySelector('[data-testid="pic-layer"] svg[data-chart-id]')
    if (!svg) return { found: false }
    const legendText = Array.from(svg.querySelectorAll('text')).map(x => x.textContent).find(t => (t || '').includes('上半年销量'))
    const bars = Array.from(svg.querySelectorAll('rect')).filter(r => {
      const fill = r.getAttribute('fill') || ''
      return fill.startsWith('#') && Number(r.getAttribute('width') || 0) > 10
    })
    const barFill = bars[0]?.getAttribute('fill') || ''
    return { found: !!legendText, legend: legendText || '', barFill, barCount: bars.length }
  })
  ok('系列名已改（图例显示「上半年销量」）', seriesState.found === true, JSON.stringify(seriesState).slice(0, 130))
  ok('系列颜色 #ed7d31 生效（柱色）', String(seriesState.barFill || '').toLowerCase() === '#ed7d31', 'fill=' + seriesState.barFill)

  }

  // ===== 3. 双击标题热区 → 图表设计选项卡 =====
  // 先点别处取消选择再双击标题热区（热区只在本体上）
  const titleHit = await page.$('[data-testid^="chart-title-hit-"]')
  if (titleHit) {
    const hb = await titleHit.boundingBox()
    // 先单击选中（mousedown 传播），再双击
    await page.mouse.click(Math.round(hb.x + hb.width / 2), Math.round(hb.y + hb.height / 2))
    await page.waitForTimeout(200)
    await page.mouse.dblclick(Math.round(hb.x + hb.width / 2), Math.round(hb.y + hb.height / 2))
    await page.waitForTimeout(400)
    const chartTabVisible = await page.locator('[data-testid="ribbon-tab-chart"]').isVisible().catch(() => false)
    ok('双击标题 → 图表设计选项卡', chartTabVisible)
  } else {
    ok('标题热区（双击编辑）存在', false, 'no chart-title-hit')
  }
} catch (e) {
  console.log('ERROR', String(e).slice(0, 400))
} finally {
  await browser.close()
  server.close()
}
const failed = results.filter(r => !r.pass).length
console.log(failed === 0 ? `\n${results.length}/${results.length} PASS` : `\n${results.length - failed}/${results.length} PASS, ${failed} FAIL`)
process.exit(failed === 0 ? 0 : 1)
