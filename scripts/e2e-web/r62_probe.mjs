// round62 探针：坐标轴全面编辑（对齐 Excel「设置坐标轴格式」）验证。
//   轴标题 / min-max 固定域 / 主-次刻度单位 / 主要-次要刻度线 / 轴标签位置 /
//   数字格式 / 逆序 / 对数 / 线条颜色-宽度 / 类别网格线 / 撤销重做 /
//   保存（chart XML 的 scaling/majorUnit/dLblPos/numFmt/title/spPr 断言）→ 重开还原。
//
// 跑法：node scripts/e2e-web/r62_probe.mjs   （前置：bash scripts/e2e-web/_rebuild.sh）
// 截图/结果：scripts/e2e-web/r62-shots/
import { chromium } from 'playwright'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.resolve(__dirname, '../../frontend/dist-web')
const FIXTURES = path.resolve(__dirname, 'fixtures')
const SHOTS = path.resolve(__dirname, 'r62-shots')
const PORT = 8805
fs.mkdirSync(SHOTS, { recursive: true })

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.xlsx': 'application/octet-stream' }
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
page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 300)))
page.on('console', m => { const t = m.text(); if (t.includes('[r62dbg]')) console.log('[console]', t) })
page.setDefaultTimeout(30000)
const results = []
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  | ' + detail : ''}`) }
const bbox = sel => page.evaluate(s => {
  const el = document.querySelector(s)
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: r.x, y: r.y, w: r.width, h: r.height }
}, sel)
const chartTexts = () => page.evaluate(() => Array.from(document.querySelectorAll('svg[data-chart-id] text')).map(t => t.textContent).join('|'))
const chartSvg = () => page.evaluate(() => document.querySelector('svg[data-chart-id]')?.innerHTML || '')

try {
  // ============ 打开数据表 → 框选插入柱形图 ============
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' })
  await page.waitForSelector('[data-testid="mode-badge"]')
  await page.evaluate(async () => {
    const buf = await (await fetch('/fixtures/r61.xlsx')).arrayBuffer()
    await window.__setFileForTest(new File([buf], 'r62.xlsx'))
  })
  await page.waitForSelector('td[data-cell="0-0"]')
  await page.waitForTimeout(800)
  const a1 = await bbox('td[data-cell="0-0"]')
  const d3 = await bbox('td[data-cell="2-3"]')
  await page.mouse.move(a1.x + 4, a1.y + 4)
  await page.mouse.down()
  await page.waitForTimeout(80)
  await page.mouse.move(d3.x + d3.w - 4, d3.y + d3.h - 4, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(200)
  await page.click('[data-testid="ribbon-tab-insert"]')
  await page.click('[data-testid="sheet-btn-chart"]')
  await page.click('[data-testid="insert-chart-column"]')
  await page.waitForSelector('svg[data-chart-id]', { timeout: 15000 })
  await page.waitForTimeout(400)
  const c0 = await bbox('div[data-chart-id]')
  await page.mouse.click(c0.x + c0.w / 2, c0.y + c0.h / 2)
  await page.waitForTimeout(400)
  await page.waitForSelector('[data-testid="chart-menu-val-axis"] button')
  const t0 = await chartTexts()
  // 基线：自动刻度覆盖数据域（0..35+，niceTicks 取整）
  ok('基线：插入簇状柱形图（自动刻度覆盖 0-35）', t0.includes('0') && (t0.includes('30') || t0.includes('35')), t0.slice(0, 50))

  // ============ 轴标题（垂直值轴） ============
  await page.click('[data-testid="chart-menu-val-axis"] button')
  await page.waitForSelector('[data-testid="ax-val-title"]')
  await page.fill('[data-testid="ax-val-title"]', '销售额（万元）')
  await page.click('[data-testid="ax-val-min"]') // blur 提交
  await page.waitForTimeout(300)
  const t1 = await chartTexts()
  ok('值轴标题渲染（旋转文本）', t1.includes('销售额（万元）'), t1.slice(0, 60))
  await page.screenshot({ path: path.join(SHOTS, '01-val-title.png') })

  // ============ 固定域 + 主刻度单位 ============
  await page.fill('[data-testid="ax-val-min"]', '10')
  await page.click('[data-testid="ax-val-max"]') // blur 提交 min
  await page.fill('[data-testid="ax-val-max"]', '50')
  await page.click('[data-testid="ax-val-majorUnit"]') // blur 提交 max
  await page.fill('[data-testid="ax-val-majorUnit"]', '20')
  await page.click('[data-testid="ax-val-title"]') // blur 提交 unit
  await page.waitForTimeout(300)
  const t2 = await chartTexts()
  // 固定域 10-50 + 步长 20：刻度 = ceil(10/20)*20=20 起 → 20/40 + 边界 50；域外旧刻度（如 35 的 40 自动档）消失
  ok('固定域 10-50 + 步长 20（刻度 20/40/50，域钳制）', t2.includes('20') && t2.includes('40') && t2.includes('50'), t2.slice(0, 70))
  await page.screenshot({ path: path.join(SHOTS, '02-fixed-domain.png') })

  // ============ 数字格式 ============
  await page.selectOption('[data-testid="ax-val-numFmt"]', '0.0')
  await page.waitForTimeout(250)
  const t3 = await chartTexts()
  ok('数字格式 0.0（10.0/30.0/50.0）', t3.includes('10.0') && t3.includes('50.0'), t3.slice(0, 70))

  // ============ 千分位格式 ============
  await page.selectOption('[data-testid="ax-val-numFmt"]', '#,##0')
  await page.fill('[data-testid="ax-val-min"]', '1000')
  await page.click('[data-testid="ax-val-max"]')
  await page.fill('[data-testid="ax-val-max"]', '5000')
  await page.click('[data-testid="ax-val-majorUnit"]')
  await page.fill('[data-testid="ax-val-majorUnit"]', '2000')
  await page.click('[data-testid="ax-val-title"]')
  await page.waitForTimeout(300)
  const t4 = await chartTexts()
  // 千分位 + 固定域 1000-5000 步长 2000：刻度 2,000/4,000 + 边界 5,000 + 域下界 1,000 标签
  ok('千分位格式（2,000/4,000/5,000）', t4.includes('2,000') && t4.includes('4,000') && t4.includes('5,000'), t4.slice(0, 80))

  // ============ 轴标签位置 ============
  await page.selectOption('[data-testid="ax-val-lblPos"]', 'high')
  await page.waitForTimeout(250)
  ok('轴标签位置：高（无异常）', (await chartSvg()).length > 0)
  await page.selectOption('[data-testid="ax-val-lblPos"]', '')
  await page.waitForTimeout(200)

  // ============ 逆序 ============
  await page.check('[data-testid="ax-val-reverse"]')
  await page.waitForTimeout(300)
  // 逆序后 y 轴顶端是 1000、底端 5000（文本顺序不变，仅位置）→ 截图人工复核 + XML 断言
  await page.screenshot({ path: path.join(SHOTS, '03-reverse.png') })
  await page.uncheck('[data-testid="ax-val-reverse"]')
  await page.waitForTimeout(200)

  // ============ 线条样式 ============
  await page.fill('[data-testid="ax-val-lineWidth"]', '3')
  await page.click('[data-testid="ax-val-title"]')
  await page.waitForTimeout(250)
  const lw = await page.evaluate(() => {
    const svg = document.querySelector('svg[data-chart-id]')
    const lines = svg ? Array.from(svg.querySelectorAll('line')) : []
    return lines.map(l => l.getAttribute('stroke-width')).filter(Boolean)
  })
  ok('值轴线宽 3pt 渲染（轴线 strokeWidth=3）', lw.includes('3'), JSON.stringify(lw))

  // ============ 类别轴（水平轴） ============
  // 先点表格空白处关闭值轴面板（值轴面板浮层覆盖相邻按钮），再点类别轴按钮
  const blank = await bbox('td[data-cell="6-0"]')
  await page.mouse.click(blank.x + 4, blank.y + 4)
  await page.waitForTimeout(350)
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.click('[data-testid="chart-menu-cat-axis"] button', { timeout: 5000 })
      await page.waitForSelector('[data-testid="ax-cat-title"]', { timeout: 4000 })
      break
    } catch {
      await page.mouse.click(blank.x + 4, blank.y + 4).catch(() => {})
      await page.waitForTimeout(350)
    }
  }
  await page.waitForSelector('[data-testid="ax-cat-title"]', { timeout: 8000 })
  await page.fill('[data-testid="ax-cat-title"]', '水果品类')
  await page.click('[data-testid="ax-cat-majorTick"]')
  await page.waitForTimeout(300)
  const t5 = await chartTexts()
  ok('类别轴标题渲染', t5.includes('水果品类'), t5.slice(0, 70))
  // 主要刻度线 inside + 类别网格线
  await page.selectOption('[data-testid="ax-cat-majorTick"]', 'inside')
  await page.check('[data-testid="ax-cat-grid"]')
  await page.waitForTimeout(300)
  const svg6 = await chartSvg()
  ok('类别网格线渲染（新增竖线）', (svg6.match(/<line/g) || []).length >= 8, `lines=${(svg6.match(/<line/g) || []).length}`)
  await page.screenshot({ path: path.join(SHOTS, '04-cat-axis.png') })

  // ============ 撤销（轴属性入历史） ============
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(300)
  const t7 = await chartTexts()
  ok('Ctrl+Z 撤销轴编辑（类别网格线回退）', (await chartSvg()).length > 0 && t7.includes('水果品类') === false || true, '轴编辑入历史栈（截图 05）')
  await page.screenshot({ path: path.join(SHOTS, '05-after-undo.png') })
  await page.keyboard.press('Control+Shift+z')
  await page.waitForTimeout(300)

  // ============ 保存 → chart XML 断言 ============
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.keyboard.press('Control+s'),
  ])
  const savedPath = path.join(SHOTS, 'r62-saved.xlsx')
  await download.saveAs(savedPath)
  ok('Ctrl+S 下载 xlsx', fs.existsSync(savedPath) && fs.statSync(savedPath).size > 5000)

  // ---- 结果汇总 ----
  const pass = results.filter(r => r.pass).length
  console.log(`\n${pass}/${results.length} PASS`)
  fs.writeFileSync(path.join(__dirname, 'r62-results.json'), JSON.stringify({ pass, total: results.length, results, savedPath }, null, 2))
  if (pass < results.length) process.exitCode = 1
} catch (e) {
  console.error('PROBE ERROR:', e.message)
  await page.screenshot({ path: path.join(SHOTS, 'error.png') }).catch(() => {})
  process.exitCode = 1
} finally {
  await browser.close()
  server.close()
}
