// Round 14 E2E 复现：1) 表格左上角手柄 hover 不稳（移动上去就消失）2) 全选后点边框按钮选择状态丢失且边框未生效
const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')

const BASE = 'http://127.0.0.1:8080'
const OUT = path.join(__dirname, 'shots-r14')
fs.mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  const errors = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 200)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)) })
  const shot = async (name) => { await page.screenshot({ path: path.join(OUT, name + '.png') }); console.log('shot:', name) }

  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  await sleep(2500)
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.evaluate(async () => {
      const buf = await fetch('/e2e_table.docx').then((r) => r.arrayBuffer())
      const file = new File([buf], 'e2e_table.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
      const dt = new DataTransfer(); dt.items.add(file)
      const target = document.querySelector('[style*="--wails-drop-target"]') || document.body
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
    })
    try { await page.waitForSelector('.ProseMirror table', { timeout: 8000 }); break } catch (e) { await sleep(1500) }
  }
  await sleep(2000)

  // ===== Bug 1：手柄 hover 稳定性 =====
  // 滚动后一次性取新鲜 viewport 几何（表格左上角 + 手柄中心）
  const g = await page.evaluate(() => {
    const wrap = document.querySelector('.ProseMirror .tableWrapper')
    if (!wrap) return null
    const t = wrap.querySelector('table')
    const h = wrap.querySelector('.pm-table-handle')
    const tb = t.getBoundingClientRect()
    window.scrollTo(0, window.scrollY + tb.top - 220)
    const tb2 = t.getBoundingClientRect()
    const hr = h ? h.getBoundingClientRect() : null
    return { left: tb2.left, top: tb2.top, handle: hr && hr.width ? { x: hr.left + hr.width / 2, y: hr.top + hr.height / 2 } : null }
  })
  console.log('fresh geom:', JSON.stringify(g))
  const left = g.left, top = g.top
  const hx = g.handle ? g.handle.x : left - 5
  const hy = g.handle ? g.handle.y : top + 5

  // 真实鼠标路径测试：进入表格 → 斜向移向手柄中心。
  // 注意：逐步 evaluate 会使 headless 渲染主线程拥塞、mousemove 被合并吞掉（真实浏览器不会），
  // 因此整条路径用连续 CDP 移动完成，结束后再统一检查状态。
  const startX = left + 150, startY = top + 60 // 表格内部
  await page.evaluate(() => { (window).__handleLog = [] })
  // 先进入表格（触发 mouseenter + document mousemove 兜底）
  await page.mouse.move(startX, startY, { steps: 6 })
  await sleep(250)
  // 斜向移向手柄（14 步连续，无 evaluate 打断）
  for (let i = 1; i <= 14; i++) {
    const x = startX + ((hx - startX) * i) / 14
    const y = startY + ((hy - startY) * i) / 14
    await page.mouse.move(x, y, { steps: 1 })
    await sleep(30)
  }
  await sleep(120)
  // 权威验证：页面内沿同一路径派发合成 mousemove（绕过 headless 事件合并伪影，
  // 逐点检验 onDocMove 处理逻辑：表内显示 → 越界 180ms 宽限 → 热区续期）
  const pathResult = await page.evaluate(() => {
    const h = document.querySelector('.ProseMirror .pm-table-handle')
    if (!h) return 'no-handle'
    const wrap = h.parentElement
    const t = wrap.querySelector('table')
    const r = t.getBoundingClientRect()
    const sx = r.left + 150, sy = r.top + 60
    const ex = r.left - 4, ey = r.top + 6 // 手柄中心（handle 位于表格左上角重叠区）
    const out = []
    for (let i = 0; i <= 14; i++) {
      const x = sx + ((ex - sx) * i) / 14
      const y = sy + ((ey - sy) * i) / 14
      window.document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y }))
      const d = getComputedStyle(h).display
      out.push(Math.round(x) + ',' + Math.round(y) + ':' + (d !== 'none' ? 'V' : 'H'))
    }
    return out.join(' ')
  })
  console.log('synthetic path visibility:\n  ' + pathResult)
  const endState = await page.evaluate(() => {
    const h = document.querySelector('.ProseMirror .pm-table-handle')
    if (!h) return { err: 'no-handle' }
    const d = getComputedStyle(h).display
    const r = h.getBoundingClientRect()
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return {
      display: d, cls: h.className,
      rect: Math.round(r.left) + ',' + Math.round(r.top) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height),
      hittable: hit === h || (hit && h.contains(hit)),
    }
  })
  const hlog = await page.evaluate(() => (window).__handleLog || [])
  console.log('handle events received during CDP path:', hlog.length, '(last: ' + (hlog[hlog.length - 1] || 'none') + ')')
  console.log('end state after continuous path:', JSON.stringify(endState))
  await shot('01-hover-path-end')

  // Bug 1 全流程验证：合成路径末端手柄可见 → 真实点击该位置
  const endPos = await page.evaluate(() => {
    const h = document.querySelector('.ProseMirror .pm-table-handle')
    const r = h.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, visible: getComputedStyle(h).display !== 'none' }
  })
  console.log('click target:', JSON.stringify(endPos))
  if (endPos.visible) {
    await page.mouse.move(endPos.x, endPos.y, { steps: 4 })
    await sleep(100)
  }
  await page.mouse.down(); await sleep(80); await page.mouse.up()
  await sleep(400)

  // Bug 1 点击结果：selectedCell 数量（真实点击）
  let selectedCells = await page.evaluate(() => document.querySelectorAll('.ProseMirror .selectedCell').length)
  console.log('after REAL handle click, selectedCell count:', selectedCells)
  await shot('02-after-select-all')
  // 兜底：若真实点击未选中（异常情况），合成 mousedown 再试
  if (selectedCells === 0) {
    selectedCells = await page.evaluate(() => {
      const h = document.querySelector('.ProseMirror .pm-table-handle')
      if (!h) return -1
      const r = h.getBoundingClientRect()
      h.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: r.left, clientY: r.top }))
      return document.querySelectorAll('.ProseMirror .selectedCell').length
    })
    await sleep(400)
    selectedCells = await page.evaluate(() => document.querySelectorAll('.ProseMirror .selectedCell').length)
    console.log('after synthetic handle mousedown, selectedCell count:', selectedCells)
    await shot('02b-after-select-all-synthetic')
  }

  // ===== Bug 2：全选后点击边框按钮 =====
  if (selectedCells > 0) {
    // 找到表格工具栏的边框按钮（▦）
    const btn = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button.toolbar-btn'))
      const b = btns.find((el) => el.title && (el.title.includes('边框') || el.title.toLowerCase().includes('border')))
      if (!b) return null
      const r = b.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, title: b.title }
    })
    console.log('border button:', JSON.stringify(btn))
    if (btn) {
      await page.mouse.move(btn.x, btn.y, { steps: 8 })
      await sleep(150)
      await page.mouse.down(); await sleep(60); await page.mouse.up()
      await sleep(400)
      const afterBtn = await page.evaluate(() => ({
        selectedCells: document.querySelectorAll('.ProseMirror .selectedCell').length,
        borderMenuOpen: !!Array.from(document.querySelectorAll('button')).find((b) => /所有框线|All Borders/.test(b.textContent || '')),
        toolbarVisible: !!Array.from(document.querySelectorAll('button.toolbar-btn')).find((b) => b.title && (b.title.includes('边框') || /border/i.test(b.title))),
      }))
      console.log('after border BUTTON click:', JSON.stringify(afterBtn))
      await shot('03-after-border-btn')
      // 点预设“所有框线”（中英文 UI 均兼容）
      const preset = await page.evaluate(() => {
        const b = Array.from(document.querySelectorAll('button')).find((x) => /所有框线|All Borders/.test(x.textContent || ''))
        if (!b) return null
        const r = b.getBoundingClientRect()
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
      })
      if (preset) {
        await page.mouse.move(preset.x, preset.y, { steps: 6 })
        await sleep(120)
        await page.mouse.down(); await sleep(60); await page.mouse.up()
        await sleep(500)
        const afterPreset = await page.evaluate(() => ({
          selectedCells: document.querySelectorAll('.ProseMirror .selectedCell').length,
          firstCellBorders: Array.from(document.querySelectorAll('.ProseMirror table td')).slice(0, 3).map((td) => td.style.borderTop + ' | ' + td.style.borderLeft),
        }))
        console.log('after preset click:', JSON.stringify(afterPreset, null, 1))
        await shot('04-after-preset')
      } else console.log('preset button NOT found (menu likely closed/unmounted)')
    }
  }

  console.log('errors:', JSON.stringify(errors.slice(0, 5)))
  await browser.close()
}
main().catch((e) => { console.error('FATAL', e); process.exit(1) })
