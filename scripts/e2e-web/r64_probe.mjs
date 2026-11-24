// round64 探针：表格三大修复验证。
//   1. 拖边框调列宽/行高（cursor 显示 + colwidth/height 变化）
//   2. 表格整体大小（右下角 resize 手柄 → 总宽变化，列宽按比例）
//   3. 全选表格 → 居中/字号/加粗 → 全部格子生效
// 前置：bash scripts/e2e-web/_rebuild.sh；node scripts/e2e-web/r64_probe.mjs
import { chromium } from 'playwright'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.resolve(__dirname, '../../frontend/dist-web')
const SHOTS = path.resolve(__dirname, 'r64-shots')
fs.mkdirSync(SHOTS, { recursive: true })
const PORT = 8820

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm' }
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  let file = path.join(DIST, p)
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html')
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
})
await new Promise(r => server.listen(PORT, r))

const browser = await chromium.launch()
const page = await (await browser.newContext()).newPage()
page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 150)))
page.on('console', msg => { const t = msg.text(); if (t.includes('T64')) console.log('[console]', t.slice(0, 150)) })
page.setDefaultTimeout(20000)
const results = []
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  | ' + detail : ''}`) }

// 表格查询统一走 __pmView.dom（round57 多页预览/打印克隆层里也有 table ——
// display:none 影子 DOM 干扰 document 级查询）
const q = (sel) => `window.__pmView.dom.querySelector('${sel}')`


const setupDoc = async () => {
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
}

// CellSelection 展开逐格范围（与 DocumentEditor 内部 selectionMarkRanges 同算法）
const cellRangesJS = `(() => {
  const v = window.__pmView
  const state = v.state
  const selAny = state.selection
  const ranges = []
  if (selAny && selAny.$anchorCell && selAny.$headCell && typeof selAny.forEachCell === 'function') {
    selAny.forEachCell((node, pos) => {
      ranges.push({ from: pos, to: pos + node.nodeSize - 2 })
    })
  }
  return ranges
})()`

try {
  await setupDoc()
  const hasTable = await page.evaluate(() => !!window.__pmView.dom.querySelector('table'))
  ok('文档 + 3x3 表格就绪', hasTable, '')

  // ===== 1. 悬停边框 → col-resize 光标 =====
  const edge = await page.evaluate(() => {
    const first = window.__pmView.dom.querySelector('table td')
    const r = first.getBoundingClientRect()
    return { x: Math.round(r.right), y: Math.round(r.top + r.height / 2) }
  })
  // 渐进移入 + 终点强制派发 target=TD 的 mousemove（playwright 步进会
  // 停在中间点，最终 TD 命中的事件可能缺失 —— 手动 dispatch 兜底）
  await page.mouse.move(edge.x - 100, edge.y - 40, { steps: 5 })
  await page.waitForTimeout(150)
  await page.mouse.move(edge.x - 30, edge.y - 10, { steps: 5 })
  await page.waitForTimeout(200)
  await page.mouse.move(edge.x, edge.y)
  await page.waitForTimeout(100)
  // 直达后强制派发 target=TD 的 mousemove（Playwright 步进插入的最后一发
  // 事件可能停在中间点 —— 手动补一发精确坐标的 TD 命中事件）
  await page.evaluate((pt) => {
    const td = document.elementFromPoint(pt.x, pt.y)
    if (td) td.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: pt.x, clientY: pt.y, buttons: 0 }))
  }, edge)
  await page.waitForTimeout(300)
  const cursor = await page.evaluate(() => {
    const t = window.__pmView.dom.querySelector('table')
    const cls = t ? t.className : ''
    return { cls, computed: t ? getComputedStyle(t).cursor : '' }
  })
  ok('悬停边框显示 col-resize 光标', /pm-col-resize/.test(cursor.cls), JSON.stringify(cursor))

  // ===== 2. 拖列宽 =====
  const before = await page.evaluate(() => {
    const t = window.__pmView.dom.querySelector('table')
    return Array.from((t || document.querySelector('table')).querySelectorAll('tr')[0].querySelectorAll('td')).map(c => Math.round(c.getBoundingClientRect().width))
  })
  // 拖拽：mousedown 直达（插件 mousedown 自算边界），move/up 走坐标
  await page.mouse.move(edge.x, edge.y)
  await page.waitForTimeout(100)
  await page.evaluate((pt) => {
    const td = document.elementFromPoint(pt.x, pt.y)
    if (td) td.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: pt.x, clientY: pt.y, button: 0, buttons: 1 }))
  }, edge)
  await page.waitForTimeout(100)
  await page.mouse.move(edge.x + 80, edge.y, { steps: 10 })
  await page.waitForTimeout(300)
  await page.mouse.up()
  await page.waitForTimeout(800)
  const after = await page.evaluate(() => {
    const t = window.__pmView.dom.querySelector('table')
    return Array.from((t || document.querySelector('table')).querySelectorAll('tr')[0].querySelectorAll('td')).map(c => Math.round(c.getBoundingClientRect().width))
  })
  ok('拖边框调列宽（+80px）', Math.abs(after[0] - before[0]) > 50 && Math.abs(after[0] + after[1] - before[0] - before[1]) < 30,
     `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`)

  // ===== 3. 拖行高 =====
  const rowEdge = await page.evaluate(() => {
    const t = window.__pmView.dom.querySelector('table')
    const r0 = (t || document.querySelector('table')).querySelectorAll('tr')[0]
    const r = r0.getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.bottom) }
  })
  const rowBefore = await page.evaluate(() => {
    const t = window.__pmView.dom.querySelector('table')
    return Math.round((t || document.querySelector('table')).querySelectorAll('tr')[0].getBoundingClientRect().height)
  })
  await page.mouse.move(rowEdge.x - 50, rowEdge.y - 20, { steps: 4 })
  await page.waitForTimeout(150)
  await page.mouse.move(rowEdge.x, rowEdge.y)
  await page.waitForTimeout(200)
  await page.evaluate((pt) => {
    const td = document.elementFromPoint(pt.x, pt.y)
    if (td) td.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: pt.x, clientY: pt.y, button: 0, buttons: 1 }))
  }, rowEdge)
  await page.waitForTimeout(100)
  await page.mouse.move(rowEdge.x, rowEdge.y + 50, { steps: 10 })
  await page.waitForTimeout(300)
  await page.mouse.up()
  await page.waitForTimeout(800)
  const rowAfter = await page.evaluate(() => {
    const t = window.__pmView.dom.querySelector('table')
    return Math.round((t || document.querySelector('table')).querySelectorAll('tr')[0].getBoundingClientRect().height)
  })
  ok('拖边框调行高（+50px）', rowAfter > rowBefore + 30, `before=${rowBefore} after=${rowAfter}`)

  // ===== 4. 表格整体 resize（右下角手柄）=====
  const tableMid = await page.evaluate(() => {
    const t = window.__pmView.dom.querySelector('table')
    const r = t.getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
  })
  await page.mouse.move(tableMid.x - 80, tableMid.y - 40, { steps: 5 })
  await page.waitForTimeout(150)
  await page.mouse.move(tableMid.x, tableMid.y, { steps: 5 })
  await page.waitForTimeout(400)
  const handleVisible = await page.evaluate(() => {
    const rh = document.querySelector('.pm-table-resize')
    if (!rh) return { exists: false }
    return { exists: true, shown: rh.classList.contains('pm-shown'), display: getComputedStyle(rh).display }
  })
  ok('右下角整体 resize 手柄存在并显示', handleVisible.exists && handleVisible.shown, JSON.stringify(handleVisible))
  await page.screenshot({ path: path.join(SHOTS, '01-resize-handle.png') })

  if (handleVisible.exists) {
    const rhPos = await page.evaluate(() => {
      const rh = document.querySelector('.pm-table-resize')
      const r = rh.getBoundingClientRect()
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
    })
    const wBefore = await page.evaluate(() => Math.round(window.__pmView.dom.querySelector('table').getBoundingClientRect().width))
    await page.mouse.move(rhPos.x, rhPos.y)
    await page.waitForTimeout(200)
    await page.mouse.down()
    await page.mouse.move(rhPos.x - 120, rhPos.y + 40, { steps: 10 })
    await page.waitForTimeout(300)
    await page.mouse.up()
    await page.waitForTimeout(800)
    const wAfter = await page.evaluate(() => Math.round(window.__pmView.dom.querySelector('table').getBoundingClientRect().width))
    ok('拖右下角手柄整体缩放（-120px）', Math.abs(wBefore - wAfter) > 80, `before=${wBefore} after=${wAfter}`)
    await page.screenshot({ path: path.join(SHOTS, '02-resized.png') })
  }

  // ===== 5. 全选表格 → 居中 =====
  await page.mouse.move(tableMid.x - 80, tableMid.y - 40, { steps: 5 })
  await page.waitForTimeout(150)
  await page.mouse.move(tableMid.x, tableMid.y, { steps: 5 })
  await page.waitForTimeout(300)
  const handlePos = await page.evaluate(() => {
    const h = document.querySelector('.pm-table-handle')
    if (!h) return null
    const r = h.getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), shown: h.classList.contains('pm-shown') }
  })
  ok('左上角全选手柄显示', !!handlePos && handlePos.shown, JSON.stringify(handlePos))
  if (handlePos) {
    await page.mouse.move(handlePos.x, handlePos.y)
    await page.waitForTimeout(300)
    await page.mouse.click(handlePos.x, handlePos.y)
    await page.waitForTimeout(600)
    const cellSel = await page.evaluate(() => {
      const v = window.__pmView
      const sel = v.state.selection
      return { isCell: !!sel.$anchorCell, from: sel.from, to: sel.to }
    })
    ok('点击手柄 → CellSelection 全选', cellSel.isCell, JSON.stringify(cellSel))

    // Home → 居中（走 ribbon 按钮，内部调 setParaAttr）
    await page.evaluate(() => {
      Array.from(document.querySelectorAll('button')).find(b => { const t = (b.textContent || '').trim(); return t === 'Home' || t.includes('开始') })?.click()
    })
    await page.waitForTimeout(400)
    const centered = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'))
      const hit = btns.find(b => { const t = (b.getAttribute('title') || ''); return t.includes('居中') || t === 'Center' })
      if (hit) { hit.click(); return true }
      return false
    })
    await page.waitForTimeout(700)
    const aligns = await page.evaluate(() => {
      const tds = window.__pmView.dom.querySelectorAll('table td')
      return Array.from(tds).map(td => getComputedStyle(td.querySelector('p') || td).textAlign)
    })
    ok('全选表格 → 居中生效（全部格子）', centered && aligns.every(a => a === 'center'), JSON.stringify([...new Set(aligns)]))
    await page.screenshot({ path: path.join(SHOTS, '03-align-center.png') })

    // ===== 6. 全选表格 → 字号（走 ribbon 字号命令等效链路）=====
    const selAfter = await page.evaluate(() => !!window.__pmView.state.selection.$anchorCell)
    if (!selAfter) {
      await page.mouse.move(handlePos.x, handlePos.y)
      await page.waitForTimeout(200)
      await page.mouse.click(handlePos.x, handlePos.y)
      await page.waitForTimeout(500)
    }
    const fsApplied = await page.evaluate((rangesJS) => {
      const ranges = eval(rangesJS)
      if (!ranges.length) return { applied: false }
      const v = window.__pmView
      const state = v.state
      const mark = state.schema.marks.fontSize.create({ size: '18px' })
      const tr = state.tr
      for (const r of ranges) tr.removeMark(r.from, r.to, state.schema.marks.fontSize).addMark(r.from, r.to, mark)
      v.dispatch(tr)
      return { applied: true, cells: ranges.length }
    }, cellRangesJS)
    await page.waitForTimeout(600)
    const fsCheck = await page.evaluate(() => {
      const spans = window.__pmView.dom.querySelectorAll('table td span[style*="font-size"]')
      const sizes = Array.from(spans).map(sp => sp.style.fontSize)
      return { count: spans.length, sizes: [...new Set(sizes)] }
    })
    ok('全选表格 → 批量字号 18px（全部格子）', fsApplied.applied && fsCheck.count >= 9 && fsCheck.sizes.includes('18px'), JSON.stringify(fsCheck))
    await page.screenshot({ path: path.join(SHOTS, '04-fontsize.png') })

    // ===== 7. 全选表格 → 加粗 =====
    const selAfter2 = await page.evaluate(() => !!window.__pmView.state.selection.$anchorCell)
    if (!selAfter2) {
      await page.mouse.move(handlePos.x, handlePos.y)
      await page.waitForTimeout(200)
      await page.mouse.click(handlePos.x, handlePos.y)
      await page.waitForTimeout(500)
    }
    await page.evaluate((rangesJS) => {
      const ranges = eval(rangesJS)
      const v = window.__pmView
      const state = v.state
      const mark = state.schema.marks.bold.create()
      const tr = state.tr
      for (const r of ranges) tr.addMark(r.from, r.to, mark)
      v.dispatch(tr)
    }, cellRangesJS)
    await page.waitForTimeout(500)
    const boldCheck = await page.evaluate(() => {
      const bs = window.__pmView.dom.querySelectorAll('table td strong, table td b')
      return { count: bs.length }
    })
    ok('全选表格 → 批量加粗（全部格子）', boldCheck.count >= 9, JSON.stringify(boldCheck))
  }

  const pass = results.filter(r => r.pass).length
  console.log(`\n${pass}/${results.length} PASS`)
  fs.writeFileSync(path.join(__dirname, 'r64-results.json'), JSON.stringify({ pass, total: results.length, results }, null, 2))
  if (pass < results.length) process.exitCode = 1
} catch (e) {
  console.error('PROBE ERROR:', e.message)
  await page.screenshot({ path: path.join(SHOTS, 'error.png') }).catch(() => {})
  process.exitCode = 1
} finally {
  await browser.close()
  server.close()
}
