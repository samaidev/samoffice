// round59 探针：复现两个用户报告的 Excel 问题（基线验证，修复后应全 PASS）
//   问题1：插入的浮动图片不在锚定单元格上，画到表头/表格外面（rowTop 少 32px 表头高）
//   问题2：框选两个格子后右下角没有填充柄（柄只在活动格=选区右下角时渲染）
//
// 跑法：node scripts/e2e-web/r59_probe.mjs   （前置：bash scripts/build-web.sh）
// 截图/结果：scripts/e2e-web/r59-shots/
import { chromium } from 'playwright'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.resolve(__dirname, '../../frontend/dist-web')
const FIXTURES = path.resolve(__dirname, 'fixtures')
const SHOTS = path.resolve(__dirname, 'r59-shots')
const PORT = 8793
fs.mkdirSync(SHOTS, { recursive: true })

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.xlsx': 'application/octet-stream' }
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  let file = path.join(DIST, p)
  if (p.startsWith('/fixtures/')) file = path.join(FIXTURES, p.slice('/fixtures/'.length))
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html')
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
})
await new Promise(r => server.listen(PORT, r))

const browser = await chromium.launch()
const page = await (await browser.newContext()).newPage()
page.setDefaultTimeout(90000)
const results = []
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  | ' + detail : ''}`) }

const bbox = sel => page.evaluate(s => {
  const el = document.querySelector(s)
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: r.x, y: r.y, w: r.width, h: r.height }
}, sel)
const cellText = (r, c) => page.evaluate(([r, c]) => document.querySelector(`td[data-cell="${r}-${c}"]`)?.querySelector('span.block')?.textContent ?? null, [r, c])
const cellCenter = async sel => { const b = await bbox(sel); return { x: b.x + b.w / 2, y: b.y + b.h / 2 } }

async function openXlsx() {
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' })
  await page.waitForSelector('[data-testid="mode-badge"]')
  await page.evaluate(async () => {
    const buf = await (await fetch('/fixtures/r59.xlsx')).arrayBuffer()
    await window.__setFileForTest(new File([buf], 'r59.xlsx'))
  })
  await page.waitForSelector('td[data-cell="0-0"]')
  await page.waitForTimeout(800)
}

try {
  await openXlsx()

  // ============ 问题1：插入图片是否落在锚定单元格上 ============
  await page.click('td[data-cell="3-4"]')
  await page.waitForTimeout(300)
  await page.click('[data-testid="ribbon-tab-insert"]')
  await page.waitForTimeout(200)
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-testid="sheet-btn-image"]')])
  await fc.setFiles(path.join(FIXTURES, 'r59.png'))
  await page.waitForSelector('img[src^="data:image"]', { timeout: 30000 })
  await page.waitForTimeout(300)
  const img = await bbox('img[src^="data:image"]')
  const anchor = await bbox('td[data-cell="3-4"]')
  const dTop = img ? img.y - anchor.y : null
  const dLeft = img ? img.x - anchor.x : null
  ok('图片左缘≈锚定格左缘(+2)', img && Math.abs(dLeft - 2) < 8, `dLeft=${dLeft?.toFixed(1)}`)
  ok('图片上缘≈锚定格上缘(+2)', img && Math.abs(dTop - 2) < 8, `dTop=${dTop?.toFixed(1)}（负值=画到锚定格上方/表头上）`)
  await page.screenshot({ path: path.join(SHOTS, 'image-anchor.png'), clip: { x: anchor.x - 100, y: Math.max(0, anchor.y - 80), width: 600, height: 300 } })

  // ============ 问题2：填充柄 ============
  // 2a 单格：点击 B1（有值 10），活动格=选区 → 应有柄（点选会进编辑态，先 Esc 退出）
  const b1 = await cellCenter('td[data-cell="0-1"]')
  await page.mouse.click(b1.x, b1.y)
  await page.waitForTimeout(300)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  const hSingle = await page.evaluate(() => !!document.querySelector('[data-fill-handle]'))
  ok('2a 单格选区有填充柄', hSingle)

  // 2b 框选两个格子 A1:A2（拖拽选择，活动格=起点A1）→ 柄应在 A2 右下角
  const a1 = await cellCenter('td[data-cell="0-0"]')
  const a2 = await cellCenter('td[data-cell="1-0"]')
  await page.mouse.move(a1.x, a1.y); await page.mouse.down()
  await page.mouse.move(a2.x, a2.y, { steps: 4 }); await page.mouse.up()
  await page.waitForTimeout(400)
  const handleInA2 = await page.evaluate(() => {
    const h = document.querySelector('[data-fill-handle]')
    if (!h) return false
    const td = h.closest('td[data-cell]')
    return td?.getAttribute('data-cell') === '1-0'
  })
  ok('2b 框选两格后柄在右下角格(A2)', handleInA2)

  // 2c 从柄拖到 A6 → 数字累加 1,2,3,4,5,6（两格源=等差延续）
  if (handleInA2) {
    const hb = await bbox('[data-fill-handle]')
    const a6 = await cellCenter('td[data-cell="5-0"]')
    await page.mouse.move(hb.x + hb.w / 2, hb.y + hb.h / 2); await page.mouse.down()
    await page.mouse.move(a6.x, a6.y, { steps: 6 }); await page.mouse.up()
    await page.waitForTimeout(400)
    const vals = []
    for (let r = 0; r < 6; r++) vals.push(await cellText(r, 0))
    ok('2c 两格源拖拽=等差延续 1..6', JSON.stringify(vals) === JSON.stringify(['1', '2', '3', '4', '5', '6']), vals.join(','))
  } else {
    ok('2c 两格源拖拽=等差延续 1..6', false, '无柄无法拖拽')
  }

  // 2d 多列独立序列：选 A1:B2 拖到第5行 → A=3,4  B=30,40
  //    （重开干净工作簿，避免 2c 残留）
  await openXlsx()
  const a1b = await cellCenter('td[data-cell="0-0"]')
  const b2 = await cellCenter('td[data-cell="1-1"]')
  await page.mouse.move(a1b.x, a1b.y); await page.mouse.down()
  await page.mouse.move(b2.x, b2.y, { steps: 4 }); await page.mouse.up()
  await page.waitForTimeout(300)
  if (await page.evaluate(() => !!document.querySelector('[data-fill-handle]'))) {
    const hb = await bbox('[data-fill-handle]')
    const b5 = await cellCenter('td[data-cell="4-1"]')
    await page.mouse.move(hb.x + hb.w / 2, hb.y + hb.h / 2); await page.mouse.down()
    await page.mouse.move(b5.x, b5.y, { steps: 5 }); await page.mouse.up()
    await page.waitForTimeout(400)
    const a = [await cellText(2, 0), await cellText(3, 0)]
    const b = [await cellText(2, 1), await cellText(3, 1)]
    ok('2d 多列各自延续 A=3,4 B=30,40', JSON.stringify(a) === JSON.stringify(['3', '4']) && JSON.stringify(b) === JSON.stringify(['30', '40']), `A=${a} B=${b}`)
  } else ok('2d 多列各自延续 A=3,4 B=30,40', false, '无柄')

  // 2e Ctrl+拖拽 = 纯复制：D1=5 拖到 D4 → 全是 5
  const d1 = await cellCenter('td[data-cell="0-3"]')
  await page.mouse.click(d1.x, d1.y)
  await page.waitForTimeout(300)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  const hb = await bbox('[data-fill-handle]')
  if (!hb) { ok('2e Ctrl拖拽=纯复制 5,5,5', false, '无柄'); }
  else {
    const d4 = await cellCenter('td[data-cell="3-3"]')
    await page.keyboard.down('Control')
    await page.mouse.move(hb.x + hb.w / 2, hb.y + hb.h / 2); await page.mouse.down()
    await page.mouse.move(d4.x, d4.y, { steps: 4 }); await page.keyboard.up('Control')
    await page.mouse.up()
    await page.waitForTimeout(400)
    const dvals = [await cellText(1, 3), await cellText(2, 3), await cellText(3, 3)]
    ok('2e Ctrl拖拽=纯复制 5,5,5', JSON.stringify(dvals) === JSON.stringify(['5', '5', '5']), dvals.join(','))
  }

  await page.screenshot({ path: path.join(SHOTS, 'fill-final.png') })
} catch (e) {
  console.error('PROBE-ERROR', e.message)
  results.push({ name: 'probe-crash', pass: false, detail: e.message })
} finally {
  fs.writeFileSync(path.join(__dirname, 'r59-results.json'), JSON.stringify(results, null, 2))
  const fails = results.filter(r => !r.pass).length
  console.log(`\n${results.length - fails}/${results.length} passed`)
  await browser.close()
  server.close()
  process.exit(fails ? 1 : 0)
}
