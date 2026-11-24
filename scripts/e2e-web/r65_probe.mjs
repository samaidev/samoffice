// round65 探针：真实鼠标路径复现「hover 边框无双箭头光标」。
// 与 r64_probe 的区别：全程只用 page.mouse.move 真实事件（不派发任何
// 手动 DOM 事件），模拟用户从表外渐进移到列边框/行边框，检查：
//   1. hover 列边框 → table 带 pm-col-resize 且计算样式 cursor=col-resize
//   2. hover 行边框 → pm-row-resize / row-resize
//   3. 全选后点击表内 → 取消全选 + caret 落在点击格（问题2）
//   4. hover 表格内部（非边框）→ 无 resize 类（不误报）
// 前置：bash scripts/e2e-web/_rebuild.sh；node scripts/e2e-web/r65_probe.mjs
import { chromium } from 'playwright'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.resolve(__dirname, '../../frontend/dist-web')
const PORT = 8821

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm' }
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, `http://x`).pathname)
  let file = path.join(DIST, p)
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html')
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
})
await new Promise(r => server.listen(PORT, r))

const browser = await chromium.launch()
const page = await (await browser.newContext()).newPage()
page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 150)))
page.setDefaultTimeout(20000)
const results = []
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  | ' + detail : ''}`) }

try {
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' })
  await page.waitForSelector('[data-testid="mode-badge"]')
  await page.waitForTimeout(600)
  await page.evaluate(() => {
    Array.from(document.querySelectorAll('button')).find(b => (b.textContent || '').includes('Files'))?.click()
  })
  await page.waitForTimeout(400)
  await page.evaluate(() => {
    Array.from(document.querySelectorAll('button')).find(b => { const t = (b.textContent || '').trim(); return t.includes('Word') || t.includes('文档') })?.click()
  })
  await page.waitForTimeout(900)
  await page.waitForSelector('.ProseMirror')
  await page.evaluate(() => {
    const v = window.__pmView
    ;(v.dom).focus()
    const { schema } = v.state
    const rows = []
    for (let r = 0; r < 3; r++) {
      const cells = []
      for (let c = 0; c < 3; c++) cells.push(schema.nodes.table_cell.create(null, schema.nodes.paragraph.create(null, schema.text(`r${r}c${c}`))))
      rows.push(schema.nodes.table_row.create(null, cells))
    }
    v.dispatch(v.state.tr.replaceSelectionWith(schema.nodes.table.create(null, rows)))
  })
  await page.waitForTimeout(700)

  const q = (sel) => `window.__pmView.dom.querySelector('${sel}')`
  const hasTable = await page.evaluate(() => !!window.__pmView.dom.querySelector('table'))
  ok('文档 + 3x3 表格就绪', hasTable, '')

  // ===== 1. 真实鼠标路径：表外 → 列边框（列1右缘中点） =====
  const edgeCol = await page.evaluate(() => {
    const first = window.__pmView.dom.querySelector('table td')
    const r = first.getBoundingClientRect()
    return { x: Math.round(r.right), y: Math.round(r.top + r.height / 2) }
  })
  // 从远处渐进移入（真实事件序列，无手动 dispatch）
  await page.mouse.move(edgeCol.x - 300, edgeCol.y - 120, { steps: 8 })
  await page.waitForTimeout(150)
  await page.mouse.move(edgeCol.x - 60, edgeCol.y - 20, { steps: 5 })
  await page.waitForTimeout(200)
  await page.mouse.move(edgeCol.x, edgeCol.y, { steps: 4 })
  await page.waitForTimeout(400)
  const cursorCol = await page.evaluate(() => {
    const t = window.__pmView.dom.querySelector('table')
    return { cls: t ? t.className : '', computed: t ? getComputedStyle(t).cursor : '', hit: document.elementFromPoint && null }
  })
  ok('真实路径 hover 列边框 → col-resize 光标', /pm-col-resize/.test(cursorCol.cls), JSON.stringify(cursorCol))

  // ===== 2. 真实鼠标路径：行边框（行0/行1交界中点） =====
  const edgeRow = await page.evaluate(() => {
    const trs = window.__pmView.dom.querySelectorAll('table tr')
    const r0 = trs[0].getBoundingClientRect()
    const r1 = trs[1].getBoundingClientRect()
    const x = Math.round(r0.left + r0.width / 2)
    return { x, y: Math.round((r0.bottom + r1.top) / 2) }
  })
  await page.mouse.move(edgeRow.x - 80, edgeRow.y - 60, { steps: 4 })
  await page.waitForTimeout(150)
  await page.mouse.move(edgeRow.x, edgeRow.y, { steps: 4 })
  await page.waitForTimeout(400)
  const cursorRow = await page.evaluate(() => {
    const t = window.__pmView.dom.querySelector('table')
    return { cls: t ? t.className : '', computed: t ? getComputedStyle(t).cursor : '' }
  })
  ok('真实路径 hover 行边框 → row-resize 光标', /pm-row-resize/.test(cursorRow.cls), JSON.stringify(cursorRow))

  // ===== 3. hover 表格内部（远离边框）→ 不应有 resize 类 =====
  const mid = await page.evaluate(() => {
    const td = window.__pmView.dom.querySelectorAll('table td')[4]
    const r = td.getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
  })
  await page.mouse.move(mid.x, mid.y, { steps: 4 })
  await page.waitForTimeout(400)
  const cursorMid = await page.evaluate(() => {
    const t = window.__pmView.dom.querySelector('table')
    return { cls: t ? t.className : '' }
  })
  ok('hover 格内部 → 无 resize 类（不误报）', !/pm-(col|row)-resize/.test(cursorMid.cls), JSON.stringify(cursorMid))

  // ===== 4. 全选后点击表内 → 取消全选 + 光标进格（问题2） =====
  // 4a. 点左上角手柄全选
  const handlePos = await page.evaluate(() => {
    const h = document.querySelector('.pm-table-handle')
    if (!h) return null
    const r = h.getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
  })
  if (handlePos) {
    await page.mouse.move(handlePos.x, handlePos.y, { steps: 3 })
    await page.waitForTimeout(250)
    await page.mouse.down()
    await page.waitForTimeout(60)
    await page.mouse.up()
    await page.waitForTimeout(300)
    const selAfter = await page.evaluate(() => {
      const s = window.__pmView.state.selection
      return { isCell: !!(s && s.$anchorCell && s.$headCell), from: s && s.from, to: s && s.to }
    })
    ok('点手柄 → 全选（CellSelection）', selAfter.isCell, JSON.stringify(selAfter))

    // 4b. 真实点击中间格（r1c1）
    await page.mouse.move(mid.x, mid.y, { steps: 4 })
    await page.waitForTimeout(150)
    await page.mouse.down()
    await page.waitForTimeout(60)
    await page.mouse.up()
    await page.waitForTimeout(400)
    const afterClick = await page.evaluate(() => {
      const v = window.__pmView
      const s = v.state.selection
      const isCell = !!(s && s.$anchorCell && s.$headCell)
      // caret 所在格：resolve(pos) 的祖先里找 table_cell
      let inCell = ''
      try {
        const $p = v.state.doc.resolve(s.from)
        for (let d = $p.depth; d > 0; d--) {
          const name = $p.node(d).type.name
          if (name === 'table_cell') { inCell = $p.node(d).textContent || '' }
        }
      } catch { /* */ }
      return { isCell, inCell: (inCell || '').trim() }
    })
    ok('全选后点击表内 → 取消全选', !afterClick.isCell, JSON.stringify(afterClick))
    ok('全选后点击表内 → 光标落在点击格（r1c1）', afterClick.inCell === 'r1c1', JSON.stringify(afterClick))
  } else {
    ok('左上角手柄存在', false, 'handle not found')
  }
} catch (e) {
  console.log('ERROR', String(e).slice(0, 300))
} finally {
  await browser.close()
  server.close()
}
const failed = results.filter(r => !r.pass).length
console.log(failed === 0 ? `\n${results.length}/${results.length} PASS` : `\n${results.length - failed}/${results.length} PASS, ${failed} FAIL`)
process.exit(failed === 0 ? 0 : 1)
