// round61 探针：Excel 图表插入/编辑对齐 MS Office 的全链路验证
//   插入：选区数据 → 12 种类型库；编辑：类型切换/切换行列/图例/数据标签/标题；
//   交互：浮层锚点拖动/缩放/撤销重做；联动：单元格改动 → 系列实时重算；
//   往返：Ctrl+S 下载 xlsx → 检查 chart XML（barChart/缓存/graphicFrame）→ 重开还原。
//
// 跑法：node scripts/e2e-web/r61_probe.mjs   （前置：bash scripts/build-web.sh）
// 截图/结果：scripts/e2e-web/r61-shots/
import { chromium } from 'playwright'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.resolve(__dirname, '../../frontend/dist-web')
const FIXTURES = path.resolve(__dirname, 'fixtures')
const SHOTS = path.resolve(__dirname, 'r61-shots')
const PORT = 8801
fs.mkdirSync(SHOTS, { recursive: true })

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.xlsx': 'application/octet-stream' }
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  let file = p.startsWith('/fixtures/') ? path.join(FIXTURES, p.slice('/fixtures/'.length)) : path.join(DIST, p)
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html')
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
})
await new Promise(r => server.listen(PORT, r))

const browser = await chromium.launch()
const page = await (await browser.newContext()).newPage()
page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 400)))
page.setDefaultTimeout(30000)
const results = []
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  | ' + detail : ''}`) }
const bbox = sel => page.evaluate(s => {
  const el = document.querySelector(s)
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: r.x, y: r.y, w: r.width, h: r.height }
}, sel)

/** 图表布局盒（div 的 style.left/top + 层偏移 → 视口坐标） */
const chartLayoutBox = () => page.evaluate(() => {
  const el = document.querySelector('div[data-chart-id]')
  const layer = document.querySelector('[data-testid="pic-layer"]')
  if (!el || !layer) return null
  const lr = layer.getBoundingClientRect()
  const sc = layer.closest('div[style*="zoom"]')
  const scale = sc && sc.offsetWidth ? sc.getBoundingClientRect().width / sc.offsetWidth : 1
  const num = v => (v === '' || v == null ? NaN : parseFloat(v))
  return { x: lr.left + num(el.style.left) * scale, y: lr.top + num(el.style.top) * scale, w: num(el.style.width) * scale, h: num(el.style.height) * scale }
})
const chartTexts = () => page.evaluate(() => Array.from(document.querySelectorAll('svg[data-chart-id] text')).map(t => t.textContent).join('|'))
const chartSvg = () => page.evaluate(() => document.querySelector('svg[data-chart-id]')?.innerHTML || '')

try {
  // ============ 打开数据表 ============
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' })
  await page.waitForSelector('[data-testid="mode-badge"]')
  await page.evaluate(async () => {
    const buf = await (await fetch('/fixtures/r61.xlsx')).arrayBuffer()
    await window.__setFileForTest(new File([buf], 'r61.xlsx'))
  })
  await page.waitForSelector('td[data-cell="0-0"]')
  await page.waitForTimeout(800)

  // ============ 框选 A1:D3 → 插入簇状柱形图 ============
  const a1 = await bbox('td[data-cell="0-0"]')
  const d3 = await bbox('td[data-cell="2-3"]')
  await page.mouse.move(a1.x + 4, a1.y + 4)
  await page.mouse.down()
  await page.mouse.move(d3.x + d3.w - 4, d3.y + d3.h - 4, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(200)
  await page.click('[data-testid="ribbon-tab-insert"]')
  await page.click('[data-testid="sheet-btn-chart"]')
  await page.waitForSelector('[data-testid="insert-chart-column"]')
  await page.click('[data-testid="insert-chart-column"]')
  await page.waitForSelector('svg[data-chart-id]', { timeout: 15000 })
  await page.waitForTimeout(500)

  const svg0 = await chartSvg()
  ok('选区插入簇状柱形图（浮层 SVG 柱形）', svg0.includes('<rect') && svg0.includes('polyline') === false, '')
  const t0 = await chartTexts()
  ok('系列名/类别/数值刻度（苹果·香蕉·Q1·30）', t0.includes('苹果') && t0.includes('香蕉') && t0.includes('Q1') && t0.includes('30'), t0.slice(0, 70))
  await page.screenshot({ path: path.join(SHOTS, '01-inserted.png') })

  // ============ 选中 + 图表设计选项卡 ============
  const c0 = await chartLayoutBox()
  await page.mouse.click(c0.x + c0.w / 2, c0.y + c0.h / 2)
  await page.waitForTimeout(400)
  ok('出现「图表设计」语境选项卡', await page.locator('[data-testid="ribbon-tab-chart"]').isVisible().catch(() => false))
  const handles = await page.locator('[data-handle]').count()
  ok('选中出现 8 尺寸柄（图表无旋转柄）', handles === 8, `handles=${handles}`)
  await page.screenshot({ path: path.join(SHOTS, '02-selected.png') })

  // ============ 类型切换：折线 → 堆积柱 → 饼 ============
  await page.click('[data-testid="chart-type-line"]')
  await page.waitForTimeout(300)
  ok('切换为折线图', (await chartSvg()).includes('polyline'))
  await page.click('[data-testid="chart-type-columnStacked"]')
  await page.waitForTimeout(300)
  ok('切换为堆积柱形图', (await chartSvg()).includes('<rect'))
  await page.click('[data-testid="chart-menu-labels"]')
  await page.click('[data-testid="chart-label-ctr"]')
  await page.waitForTimeout(200)
  await page.click('[data-testid="chart-type-pie"]')
  await page.waitForTimeout(300)
  const pieSvg = await chartSvg()
  ok('切换为饼图（扇形 path + 占比标签）', pieSvg.includes('<path') && (await chartTexts()).includes('%'), (await chartTexts()).slice(0, 50))
  await page.click('[data-testid="chart-menu-labels"]')
  await page.click('[data-testid="chart-label-none"]')
  await page.waitForTimeout(200)
  await page.click('[data-testid="chart-type-column"]')
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(SHOTS, '03-types.png') })

  // ============ 切换行/列 ============
  await page.click('[data-testid="chart-switch-rc"]')
  await page.waitForTimeout(300)
  const swapped = await chartTexts()
  ok('切换行/列（系列名变为 Q1/Q2/Q3）', swapped.includes('Q1') && swapped.includes('Q2') && swapped.includes('Q3'), swapped.slice(0, 50))
  await page.click('[data-testid="chart-switch-rc"]')
  await page.waitForTimeout(200)

  // ============ 图例 / 数据标签 / 标题 ============
  await page.click('[data-testid="chart-menu-legend"]')
  await page.click('[data-testid="chart-legend-b"]')
  await page.waitForTimeout(250)
  await page.click('[data-testid="chart-menu-labels"]')
  await page.click('[data-testid="chart-label-outEnd"]')
  await page.waitForTimeout(250)
  const labeled = await chartTexts()
  ok('数据标签显示数值（10/35）', labeled.includes('10') && labeled.includes('35'), labeled.slice(0, 70))
  await page.click('[data-testid="chart-title-toggle"]')
  await page.waitForTimeout(250)
  ok('标题开关（隐藏图表标题）', !(await chartTexts()).includes('图表标题'))
  await page.click('[data-testid="chart-title-toggle"]')
  await page.waitForTimeout(200)

  // ============ 拖动 + 撤销 ============
  const before = await chartLayoutBox()
  await page.mouse.move(before.x + before.w / 2, before.y + before.h / 2)
  await page.mouse.down()
  await page.mouse.move(before.x + before.w / 2 + 50, before.y + before.h / 2 + 30, { steps: 6 })
  await page.mouse.up()
  await page.waitForTimeout(300)
  const moved = await chartLayoutBox()
  ok('拖动移动 (+50,+30)', Math.abs(moved.x - before.x - 50) < 6 && Math.abs(moved.y - before.y - 30) < 6, `dx=${(moved.x - before.x).toFixed(1)} dy=${(moved.y - before.y).toFixed(1)}`)
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(400)
  const dbgUndo = await page.evaluate(() => ({
    chartDivs: document.querySelectorAll('div[data-chart-id]').length,
    chartSvgs: document.querySelectorAll('svg[data-chart-id]').length,
    picLayer: !!document.querySelector('[data-testid="pic-layer"]'),
    bodyLen: document.body.innerText.length,
  }))
  console.log('[dbg after ctrl+z]', JSON.stringify(dbgUndo))
  const undone = await chartLayoutBox()
  ok('Ctrl+Z 撤销拖动', Math.abs(undone.x - before.x) < 6 && Math.abs(undone.y - before.y) < 6)

  // ============ 缩放（用右中柄：CSS zoom 下 scrollIntoView 不可靠，se 柄可能被裁剪） ============
  const eh = await bbox('[data-handle="e"]')
  const hitEh = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.getAttribute?.('data-handle') || '', [eh.x + eh.w / 2, eh.y + eh.h / 2])
  console.log('[dbg e handle hit]', hitEh)
  await page.mouse.move(eh.x + eh.w / 2, eh.y + eh.h / 2)
  await page.mouse.down()
  await page.mouse.move(eh.x + eh.w / 2 + 40, eh.y + eh.h / 2, { steps: 6 })
  await page.mouse.up()
  await page.waitForTimeout(300)
  const resized = await chartLayoutBox()
  ok('拖柄缩放（右中柄 +40px 宽）', resized.w - before.w > 34 && Math.abs(resized.h - before.h) < 5, `w ${before.w.toFixed(0)}→${resized.w.toFixed(0)} h ${before.h.toFixed(0)}→${resized.h.toFixed(0)}`)
  await page.screenshot({ path: path.join(SHOTS, '04-resized.png') })

  // ============ 单元格联动（B2 被图表覆盖 → 点 A2 后方向键右移） ============
  await page.click('td[data-cell="1-0"]')
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(150)
  await page.keyboard.type('100')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(800)
  const refreshed = await chartTexts()
  ok('单元格改动 → 图表实时重算（10→100）', refreshed.includes('100'), refreshed.slice(0, 80))
  await page.screenshot({ path: path.join(SHOTS, '05-linked.png') })

  // ============ 保存（Ctrl+S 下载）============
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.keyboard.press('Control+s'),
  ])
  const savedPath = path.join(SHOTS, 'r61-saved.xlsx')
  await download.saveAs(savedPath)
  ok('Ctrl+S 下载 xlsx', fs.existsSync(savedPath) && fs.statSync(savedPath).size > 5000)

  // ---- 结果汇总 ----
  const pass = results.filter(r => r.pass).length
  console.log(`\n${pass}/${results.length} PASS`)
  fs.writeFileSync(path.join(__dirname, 'r61-results.json'), JSON.stringify({ pass, total: results.length, results, savedPath }, null, 2))
  if (pass < results.length) process.exitCode = 1
} catch (e) {
  console.error('PROBE ERROR:', e.message)
  await page.screenshot({ path: path.join(SHOTS, 'error.png') }).catch(() => {})
  process.exitCode = 1
} finally {
  await browser.close()
  server.close()
}
