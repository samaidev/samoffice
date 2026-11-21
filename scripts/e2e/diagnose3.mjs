// diagnose3.mjs — 复现用户报告的三问题并截图取证
// 问题1：标签页无法拖动排序（dragstart 是否被 WailsInvoke('drag') 或 mousedown preventDefault 干扰）
// 问题2：Excel 左上角行列标头区看不到边框
// 问题3：Excel 打印预览未应用现有单元格样式（bold/bg/border 等）
import { chromium } from 'playwright'
import fs from 'fs'
import { join } from 'path'

const OFFICE = 'http://localhost:18400'
const SHOTS = '/home/z/my-project/samoffice/scripts/e2e/round51-shots'
fs.mkdirSync(SHOTS, { recursive: true })

const results = []
const ok = (name, pass, info = '') => { results.push([name, !!pass, String(info).slice(0, 200)]); console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${info}`) }

async function main() {
  const browser = await chromium.launch({ args: ['--no-sandbox'] })
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } })
  const page = await ctx.newPage()

  await page.addInitScript(() => {
    window.__wailsInvokes = []
    window.WailsInvoke = (msg) => { window.__wailsInvokes.push(msg) }
  })

  await page.goto(OFFICE, { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(1500)
  await page.evaluate(() => { localStorage.setItem('samoffice_lang', 'zh') })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)

  // ══════════ 问题1：标签拖拽 ══════════
  // 新建三个不同类型文档产生多个 tab
  await page.locator('[data-testid="menu-files"]').click()
  await page.waitForTimeout(400)
  await page.locator('text=📝').first().click()
  await page.waitForTimeout(700)
  await page.locator('[data-testid="menu-files"]').click()
  await page.waitForTimeout(400)
  await page.locator('text=📊').first().click() // 新建表格
  await page.waitForTimeout(700)
  await page.locator('[data-testid="menu-files"]').click()
  await page.waitForTimeout(400)
  await page.locator('text=📽').first().click() // 新建幻灯
  await page.waitForTimeout(700)

  const tabsBefore = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid^="tab-"][data-testid^="tab-document"], [data-testid^="tab-spreadsheet"], [data-testid^="tab-slide"]'))
      .map(el => el.getAttribute('data-testid')))
  ok('P1 准备：三个标签存在', tabsBefore.length >= 3, JSON.stringify(tabsBefore))

  // 监听 dragstart/dragover/drop 事件是否真的派发到 tab 元素
  await page.evaluate(() => {
    window.__evlog = []
    for (const ev of ['dragstart', 'dragover', 'drop', 'dragend']) {
      document.addEventListener(ev, (e) => {
        const t = e.target
        const tid = t && t.closest ? (t.closest('[data-testid^="tab-"]')?.getAttribute('data-testid') || t.tagName) : '?'
        window.__evlog.push(`${ev}:${tid}:${e.defaultPrevented}`)
      }, true)
    }
  })

  const tabDoc = page.locator('[data-testid="tab-document"]').first()
  const tabSlide = page.locator('[data-testid="tab-slide"]').first()
  const b1 = await tabDoc.boundingBox()
  const b3 = await tabSlide.boundingBox()
  if (b1 && b3) {
    await page.mouse.move(b1.x + b1.width / 2, b1.y + b1.height / 2)
    await page.mouse.down()
    await page.mouse.move(b3.x + b3.width / 2, b3.y + b3.height / 2, { steps: 12 })
    await page.waitForTimeout(300)
    await page.mouse.up()
    await page.waitForTimeout(500)
  }
  const evlog = await page.evaluate(() => window.__evlog)
  ok('P1 事件流：dragstart 派发到 tab', evlog.some(e => e.startsWith('dragstart:tab-')), JSON.stringify(evlog.slice(0, 6)))

  const tabsAfter = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid^="tab-"]'))
      .map(el => el.getAttribute('data-testid')).filter(x => x !== 'tab-about'))
  ok('P1 结果：顺序改变', JSON.stringify(tabsAfter) !== JSON.stringify(tabsBefore), `${JSON.stringify(tabsBefore)} -> ${JSON.stringify(tabsAfter)}`)

  await page.screenshot({ path: join(SHOTS, 'p1-tabs.png') })

  // ══════════ 问题2+3：Excel ══════════
  // 切到表格 tab（拖拽后 spreadsheet tab 还在）
  await page.locator('[data-testid="tab-spreadsheet"]').first().click().catch(async () => {
    // 若拖拽把顺序改了，重开一个
    await page.locator('[data-testid="menu-files"]').click()
    await page.waitForTimeout(400)
    await page.locator('text=📊').first().click()
  })
  await page.waitForTimeout(800)

  // 写入带样式的单元格做打印预览对比
  await page.evaluate(() => {
    // 直接通过前端全局钩子或 DOM 事件输入。用双击进入编辑的方式太慢，
    // 检查 window 上是否有 __setDocForTest 类似钩子
    return Object.keys(window).filter(k => k.startsWith('__'))
  }).then(keys => console.log('test hooks:', keys))

  // 用键盘输入方式：选中 A1 输入文本
  const grid = await page.evaluate(() => {
    const td = document.querySelector('td[data-cell="0-0"]')
    if (td) { td.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); return true }
    return false
  })
  ok('P2 网格存在', grid === true)

  // 截图左上角区域（行列标头）
  await page.evaluate(() => {
    const sc = document.querySelector('.overflow-auto') || document.scrollingElement
    if (sc) sc.scrollTop = 0
  })
  await page.waitForTimeout(400)
  const gridBox = await page.locator('td[data-cell="0-0"]').boundingBox()
  if (gridBox) {
    await page.screenshot({
      path: join(SHOTS, 'p2-corner.png'),
      clip: { x: Math.max(0, gridBox.x - 80), y: Math.max(0, gridBox.y - 60), width: 420, height: 300 }
    })
  }

  // 检查左上角 th 的 computed border
  const cornerInfo = await page.evaluate(() => {
    const th = document.querySelector('thead th') // 第一个 th = 左上角
    if (!th) return null
    const cs = getComputedStyle(th)
    return { border: `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`, bg: cs.backgroundColor, visible: th.offsetWidth > 0 }
  })
  ok('P2 左上角 th 边框 computed', !!cornerInfo, JSON.stringify(cornerInfo))

  // 列标头与行号头的边框
  const headerBorders = await page.evaluate(() => {
    const colTh = document.querySelector('thead tr th:nth-child(2)')
    const rowTd = document.querySelector('tbody tr td')
    const out = {}
    if (colTh) { const cs = getComputedStyle(colTh); out.colTh = `${cs.borderTopWidth}/${cs.borderLeftWidth} ${cs.borderTopColor}` }
    if (rowTd) { const cs = getComputedStyle(rowTd); out.rowTd = `${cs.borderTopWidth}/${cs.borderLeftWidth} ${cs.borderTopColor}` }
    return out
  })
  ok('P2 表头边框详情', true, JSON.stringify(headerBorders))

  // ══════════ 问题3：打印预览 ══════════
  // 给 A1 加粗 + 填充色，然后打开打印预览看是否体现
  // 方式：输入文本后 Ctrl+B
  await page.locator('td[data-cell="0-0"]').click()
  await page.keyboard.type('Header1')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(300)
  await page.locator('td[data-cell="0-1"]').click()
  await page.keyboard.type('Data')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(300)
  // 选 A1 加粗
  await page.locator('td[data-cell="0-0"]').click()
  await page.keyboard.press('Control+b')
  await page.waitForTimeout(300)

  // 打印按钮在「视图」ribbon tab 下
  await page.locator('button', { hasText: '视图' }).first().click()
  await page.waitForTimeout(400)
  await page.locator('[data-testid="excel-print-btn"]').click()
  await page.waitForTimeout(900)
  const hasDialog = await page.locator('[data-testid="print-dialog"]').count()
  ok('P3 打印对话框打开', hasDialog >= 1, `count=${hasDialog}`)
  await page.screenshot({ path: join(SHOTS, 'p3-print-preview.png') })

  // 检查预览表格里 A1 是否有加粗
  const previewInfo = await page.evaluate(() => {
    const dlg = document.querySelector('[data-testid="print-dialog"]')
    if (!dlg) return null
    const tds = Array.from(dlg.querySelectorAll('td'))
    const first = tds.find(td => td.textContent.includes('Header1'))
    if (!first) return { found: false }
    const cs = getComputedStyle(first)
    return { found: true, bold: cs.fontWeight, bg: cs.backgroundColor, text: first.textContent }
  })
  ok('P3 预览含 A1 且样式', !!previewInfo, JSON.stringify(previewInfo))

  await page.keyboard.press('Escape')
  await browser.close()

  console.log('\n===== 汇总 =====')
  for (const [n, p, i] of results) console.log(`${p ? '✓' : '✗'} ${n} — ${i}`)
  const fails = results.filter(r => !r[1]).length
  console.log(fails === 0 ? 'ALL PASS' : `${fails} FAIL`)
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
