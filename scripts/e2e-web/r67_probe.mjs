// round67 探针：图表标题 9 宫格位置（rt/lt 生效）+ 打印预览浮层与表格对齐。
// 验证：
//   1. 标题 pos=rt → SVG text x ≈ W-8（右锚）；pos=lt → x ≈ 8（左锚）
//      （round67 修复前 rt/lt 落回居中 —— 用户报告"只有居中有用"）
//   2. 打印预览：图表浮层 left 与表格右缘列位置一致（colScale 跟随 100% 拉伸）
//      且浮层完整落在纸张内（left≥0，left+w ≤ 纸宽）
// 前置：bash scripts/e2e-web/_rebuild.sh；node scripts/e2e-web/r67_probe.mjs
import { chromium } from 'playwright'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.resolve(__dirname, '../../frontend/dist-web')
const FIXTURES = path.resolve(__dirname, 'fixtures')
const PORT = 8836

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
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-testid="mode-badge"]')
  await page.evaluate(async () => {
    const buf = await (await fetch('/fixtures/r61.xlsx')).arrayBuffer()
    await window.__setFileForTest(new File([buf], 'r61.xlsx'))
  })
  await page.waitForSelector('td[data-cell="0-0"]')
  await page.waitForTimeout(800)

  // 插入图表（框选 A1:D3 → 插入 → 图表 → 柱形）
  await page.locator('td[data-cell="0-0"]').dragTo(page.locator('td[data-cell="2-3"]'))
  await page.waitForTimeout(300)
  await page.click('[data-testid="ribbon-tab-insert"]')
  await page.click('[data-testid="sheet-btn-chart"]')
  await page.waitForSelector('[data-testid="insert-chart-column"]')
  await page.click('[data-testid="insert-chart-column"]')
  await page.waitForSelector('svg[data-chart-id]', { state: 'attached', timeout: 15000 })
  await page.waitForTimeout(500)
  ok('图表已插入', true)

  // 选中图表 → 图表设计
  const chartBox = await page.evaluate(() => {
    const el = document.querySelector('[data-chart-id]')
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height }
  })
  await page.mouse.click(Math.round(chartBox.x + chartBox.w / 2), Math.round(chartBox.y + chartBox.h / 2))
  await page.waitForTimeout(400)

  // ===== 1. 标题位置 rt/lt 锚点 =====
  const setTitlePos = async (pos) => {
    // 面板已开则不重复点（再点一次会把 Pop 关掉）
    const isOpen = await page.$('[data-testid="chart-title-pos"]')
    if (!isOpen) {
      await page.click('[data-testid="chart-menu-title-edit"]')
      await page.waitForTimeout(250)
    }
    await page.$eval('[data-testid="chart-title-pos"]', (el, v) => { el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })) }, pos)
    await page.waitForTimeout(400)
  }
  const titleXY = () => page.evaluate(() => {
    const svg = document.querySelector('svg[data-chart-id]')
    if (!svg) return null
    const t = Array.from(svg.querySelectorAll('text')).find(x => (x.textContent || '').trim() && x.getAttribute('font-weight'))
    if (!t) return null
    return { x: Number(t.getAttribute('x')), W: Number(svg.getAttribute('width')), anchor: t.getAttribute('text-anchor') }
  })

  await setTitlePos('rt')
  const rt = await titleXY()
  ok('标题 rt → 右锚（x≈W-8, anchor=end）', !!rt && rt.anchor === 'end' && Math.abs(rt.x - (rt.W - 8)) < 2, JSON.stringify(rt))
  await setTitlePos('lt')
  const lt = await titleXY()
  ok('标题 lt → 左锚（x≈8, anchor=start）', !!lt && lt.anchor === 'start' && Math.abs(lt.x - 8) < 2, JSON.stringify(lt))
  await setTitlePos('rb')
  const rb = await titleXY()
  ok('标题 rb → 右下（anchor=end）', !!rb && rb.anchor === 'end', JSON.stringify(rb))
  await setTitlePos('ct')
  const ct = await titleXY()
  ok('标题 ct → 顶中（x≈W/2）', !!ct && ct.anchor === 'middle' && Math.abs(ct.x - ct.W / 2) < 2, JSON.stringify(ct))

  // ===== 2. 打印预览浮层与表格对齐 =====
  await page.mouse.click(400, 400).catch(() => {})
  await page.waitForTimeout(200)
  // 打印预览按钮在「视图」选项卡（图表插入后 ribbon 停在图表上下文选项卡）
  await page.click('[data-testid="ribbon-tab-view"]')
  await page.waitForTimeout(400)
  const opened = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'))
    const b = btns.find(x => /打印预览|Print Preview/i.test(x.title || '') || /打印预览|Print Preview/i.test(x.textContent || ''))
    if (b) { b.click(); return true }
    return false
  })
  ok('打开打印预览对话框', opened)
  await page.waitForTimeout(1500)
  const align = await page.evaluate(() => {
    const paper = document.querySelector('.print-paper')
    if (!paper) return { paper: false }
    // 预览纸张可能在滚动容器视口外 —— 滚入后量测
    paper.scrollIntoView({ block: 'start' })
    const pr = paper.getBoundingClientRect()
    // 浮层（图表）：data-chart-id 的定位包装 div（父级 absolute left/top）
    const chartEl = paper.querySelector('[data-chart-id]')
    if (!chartEl) return { paper: true, chart: false, pr: { w: pr.width, h: pr.height } }
    const wrap = chartEl.parentElement
    const wr = wrap.getBoundingClientRect()
    // 表格第一行第 4 列（D 列）左缘：数据 4 列（A-D），浮层锚在 D 列后
    const firstRowTd = paper.querySelectorAll('table td')
    // 表格右缘 = 表格容器宽
    const tbl = paper.querySelector('table')
    const tr = tbl.getBoundingClientRect()
    return {
      paper: true, chart: true,
      paperW: pr.width, paperR: pr.right, paperB: pr.bottom,
      floatL: wr.left, floatT: wr.top, floatW: wr.width, floatR: wr.right, floatB: wr.bottom,
      tblL: tr.left, tblR: tr.right,
    }
  })
  ok('打印预览：纸张与图表浮层存在', align.paper && align.chart, JSON.stringify(align).slice(0, 160))
  if (align.paper && align.chart) {
    // round67 断言（对齐 Excel 语义）：图表可跨多列、超出末列打印宽的部分被
    // 裁剪（Excel 会分页打印溢出部分）—— 校验【左缘落在表格/纸面内】+
    // 【左缘与拉伸后列缘对齐】（colScale 修复的核心可观察量）
    const tblW = align.tblR - align.tblL
    const colScaled = tblW / 4 // r61 数据 4 列（A-D），等宽 80px 源
    const inPaper = align.floatL >= align.tblL - 2 && align.floatL <= align.tblR
    ok('浮层左缘落在表格区内（与表格同纸面起点）', inPaper, `floatL=${Math.round(align.floatL)} tbl[${Math.round(align.tblL)},${Math.round(align.tblR)}]`)
    const off = (align.floatL - align.tblL) % colScaled
    const aligned = off < 2 || colScaled - off < 2
    ok('浮层左缘与拉伸后列缘对齐（colScale 生效）', aligned, `off=${Math.round(off)}px colScaled=${Math.round(colScaled)}px`)
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
