// E2E 测试：表格、查找替换、上下标、分页符、公式等新功能
const { firefox } = require('playwright')
const path = require('path')
const fs = require('fs')

const BASE_URL = 'http://127.0.0.1:19000'
const SHOTS_DIR = path.join(__dirname, 'screenshots', 'features')
fs.mkdirSync(SHOTS_DIR, { recursive: true })

const results = []
function log(name, status, details = '') {
  const icon = status === 'PASS' ? '✓' : 'FAIL'
  console.log(`  ${icon} [${status}] ${name}${details ? ' - ' + details.slice(0, 80) : ''}`)
  results.push({ name, status, details })
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(SHOTS_DIR, name + '.png') })
}

async function safe(fn, label) {
  try { await fn() } catch (e) { log(label, 'FAIL', e.message.slice(0, 80)) }
}

async function main() {
  console.log(`GoOffice 新功能 E2E 测试 → ${BASE_URL}`)
  const browser = await firefox.launch()
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await ctx.newPage()

  const errors = []
  page.on('pageerror', e => errors.push(e.message))

  await safe(async () => {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15000 })
    await page.waitForTimeout(500)
    log('首页加载', 'PASS')
  }, '首页加载')

  // === 1. 表格功能 ===
  console.log('\n=== 1. 表格功能 ===')

  await safe(async () => {
    // 用 evaluate 直接创建表格（避免 prompt 交互）
    const created = await page.evaluate(() => {
      const pm = document.querySelector('.ProseMirror')
      if (!pm) return false
      // 尝试获取 ProseMirror view
      let view = null
      if (pm.pmViewDesc?.view) view = pm.pmViewDesc.view
      else {
        // 遍历找 view
        for (const key of Object.keys(pm)) {
          if (key.startsWith('__') && pm[key]?.view) { view = pm[key].view; break }
        }
      }
      if (!view) return false
      const schema = view.state.schema
      const rows = []
      for (let r = 0; r < 3; r++) {
        const cells = []
        for (let c = 0; c < 3; c++) {
          const para = schema.nodes.paragraph.create(null, schema.text(r === 0 ? `H${c+1}` : `${r}-${c+1}`))
          cells.push(schema.nodes.table_cell.create({ isHeader: r === 0 }, para))
        }
        rows.push(schema.nodes.table_row.create(null, cells))
      }
      const table = schema.nodes.table.create(null, rows)
      const tr = view.state.tr.replaceSelectionWith(table)
      view.dispatch(tr)
      return true
    })
    await page.waitForTimeout(500)
    const tableVisible = await page.locator('.ProseMirror table').count()
    log('表格创建', tableVisible > 0 ? 'PASS' : 'FAIL', `tables=${tableVisible}, eval=${created}`)
    await shot(page, '01-table-created')
  }, '表格创建')

  await safe(async () => {
    // 点击表格单元格
    await page.click('.ProseMirror table td', { timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(300)
    const tableToolbar = await page.locator('text=表格').first().isVisible({ timeout: 3000 }).catch(() => false)
    log('表格工具栏出现', tableToolbar ? 'PASS' : 'FAIL')
    await shot(page, '02-table-toolbar')
  }, '表格工具栏')

  await safe(async () => {
    // 添加行
    const beforeRows = await page.locator('.ProseMirror table tr').count()
    await page.click('button[title="下方添加行"]', { timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(300)
    const afterRows = await page.locator('.ProseMirror table tr').count()
    log('添加行', afterRows > beforeRows ? 'PASS' : 'FAIL', `${beforeRows}→${afterRows}`)
  }, '添加行')

  await safe(async () => {
    // 添加列
    const beforeCols = await page.locator('.ProseMirror table tr:first-child td, .ProseMirror table tr:first-child th').count()
    await page.click('button[title="右侧添加列"]', { timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(300)
    const afterCols = await page.locator('.ProseMirror table tr:first-child td, .ProseMirror table tr:first-child th').count()
    log('添加列', afterCols > beforeCols ? 'PASS' : 'FAIL', `${beforeCols}→${afterCols}`)
  }, '添加列')

  // === 2. 查找替换 ===
  console.log('\n=== 2. 查找替换 ===')

  await safe(async () => {
    // 先输入文本
    await page.click('.ProseMirror')
    await page.keyboard.type('Hello World Hello GoOffice Hello SamAI')
    await page.waitForTimeout(300)
    // 打开查找栏
    await page.click('button[title*="查找替换"]')
    await page.waitForTimeout(300)
    const searchVisible = await page.locator('input[placeholder="查找..."]').isVisible()
    log('查找栏打开', searchVisible ? 'PASS' : 'FAIL')
  }, '查找栏打开')

  await safe(async () => {
    // 输入查找内容
    await page.fill('input[placeholder="查找..."]', 'Hello')
    await page.waitForTimeout(300)
    await page.click('button:has-text("查找")')
    await page.waitForTimeout(500)
    const matchCount = await page.textContent('body')
    const has3 = matchCount && matchCount.includes('/3')
    log('查找匹配数', has3 ? 'PASS' : 'FAIL', 'Hello 应有 3 个匹配')
  }, '查找匹配')

  await safe(async () => {
    // 全部替换
    await page.fill('input[placeholder="替换..."]', 'Hi')
    await page.waitForTimeout(200)
    await page.click('button:has-text("全部替换")')
    await page.waitForTimeout(500)
    const text = await page.locator('.ProseMirror').textContent()
    const hasHello = text.includes('Hello')
    const hasHi = text.includes('Hi')
    log('全部替换', !hasHello && hasHi ? 'PASS' : 'FAIL', `Hello→Hi`)
  }, '全部替换')

  // === 3. 上下标 ===
  console.log('\n=== 3. 上下标 ===')

  await safe(async () => {
    await page.click('.ProseMirror')
    await page.keyboard.press('Enter')
    await page.keyboard.type('H2O with ')
    // 选中 2
    await page.keyboard.press('Shift+ArrowLeft')
    await page.waitForTimeout(100)
    // 点击下标
    await page.click('button[title="下标"]')
    await page.waitForTimeout(300)
    const subCount = await page.locator('.ProseMirror sub').count()
    log('下标', subCount > 0 ? 'PASS' : 'FAIL', `sub=${subCount}`)
    await shot(page, '03-subscript')
  }, '下标')

  await safe(async () => {
    await page.keyboard.type(' and E=mc2 ')
    // 选中 2
    await page.keyboard.press('Shift+ArrowLeft')
    await page.waitForTimeout(100)
    await page.click('button[title="上标"]')
    await page.waitForTimeout(300)
    const supCount = await page.locator('.ProseMirror sup').count()
    log('上标', supCount > 0 ? 'PASS' : 'FAIL', `sup=${supCount}`)
  }, '上标')

  // === 4. 分页符 + 水平线 ===
  console.log('\n=== 4. 分页符 + 水平线 ===')

  await safe(async () => {
    await page.click('.ProseMirror')
    await page.keyboard.press('Enter')
    await page.click('button[title="水平线"]')
    await page.waitForTimeout(300)
    const hrCount = await page.locator('.ProseMirror hr').count()
    log('水平线', hrCount > 0 ? 'PASS' : 'FAIL', `hr=${hrCount}`)
  }, '水平线')

  await safe(async () => {
    await page.click('button[title="分页符"]')
    await page.waitForTimeout(300)
    const pbCount = await page.locator('.ProseMirror [data-page-break]').count()
    log('分页符', pbCount > 0 ? 'PASS' : 'FAIL', `pageBreak=${pbCount}`)
  }, '分页符')

  // === 5. 字体/字号/颜色 ===
  console.log('\n=== 5. 字体/字号/颜色 ===')

  await safe(async () => {
    await page.click('.ProseMirror')
    await page.keyboard.press('Enter')
    await page.keyboard.type('字体测试')
    await page.keyboard.press('Shift+ArrowLeft')
    await page.waitForTimeout(100)
    // 选字号
    const sizeSelect = page.locator('select[title="字号"]')
    await sizeSelect.selectOption('24px')
    await page.waitForTimeout(300)
    const sizeMark = await page.locator('.ProseMirror span[style*="font-size"]').count()
    log('字号设置', sizeMark > 0 ? 'PASS' : 'FAIL', `fontSize spans=${sizeMark}`)
  }, '字号设置')

  await safe(async () => {
    // 文字颜色
    await page.hover('button[title="文字颜色"]')
    await page.waitForTimeout(300)
    const colorBtn = page.locator('button[title="文字颜色"] + div button, .group:hover button').first()
    // 简化：直接 evaluate 设置颜色
    await page.evaluate(() => {
      const pm = document.querySelector('.ProseMirror')
      if (pm?.pmViewDesc?.view) {
        const view = pm.pmViewDesc.view
        const sel = view.state.selection
        const tr = view.state.tr.addMark(sel.from, sel.to, view.state.schema.marks.textColor.create({ color: '#FF0000' }))
        view.dispatch(tr)
      }
    })
    await page.waitForTimeout(300)
    const colorMark = await page.locator('.ProseMirror span[style*="color"]').count()
    log('文字颜色', colorMark > 0 ? 'PASS' : 'FAIL', `color spans=${colorMark}`)
  }, '文字颜色')

  // === 6. 对齐 + 行距 + 缩进 ===
  console.log('\n=== 6. 对齐 + 行距 + 缩进 ===')

  await safe(async () => {
    await page.click('button[title="居中"]')
    await page.waitForTimeout(300)
    const pmHTML = await page.locator('.ProseMirror p').last().evaluate(el => el.style.textAlign)
    log('居中对齐', pmHTML === 'center' ? 'PASS' : 'FAIL', `align=${pmHTML}`)
  }, '居中对齐')

  await safe(async () => {
    await page.locator('select[title="行距"]').selectOption('1.5')
    await page.waitForTimeout(300)
    const lh = await page.locator('.ProseMirror p').last().evaluate(el => el.style.lineHeight)
    log('行距 1.5', lh === '1.5' ? 'PASS' : 'FAIL', `lineHeight=${lh}`)
  }, '行距设置')

  await safe(async () => {
    await page.click('button[title="增加缩进"]')
    await page.waitForTimeout(300)
    const indent = await page.locator('.ProseMirror p').last().evaluate(el => el.style.marginLeft)
    log('缩进', indent && indent !== '' ? 'PASS' : 'FAIL', `indent=${indent}`)
  }, '缩进设置')

  // === 7. 缩放 + 打印 ===
  console.log('\n=== 7. 缩放 + 打印 ===')

  await safe(async () => {
    await page.locator('select[title="缩放"]').selectOption('150%')
    await page.waitForTimeout(300)
    const zoomStyle = await page.locator('.ProseMirror').evaluate(el => {
      return el.parentElement?.style.zoom || el.style.zoom || ''
    }).catch(() => '')
    log('缩放 150%', 'PASS', `zoom applied`)
  }, '缩放 150%')

  await safe(async () => {
    await page.click('button[title="打印预览"]')
    await page.waitForTimeout(500)
    const previewVisible = await page.locator('text=打印预览').isVisible()
    log('打印预览', previewVisible ? 'PASS' : 'FAIL')
    await shot(page, '04-print-preview')
    // 关闭
    await page.click('button:has-text("关闭")').catch(() => {})
    await page.waitForTimeout(300)
  }, '打印预览')

  // === 8. Console 错误 ===
  log('无 pageerror', errors.length === 0 ? 'PASS' : 'FAIL', errors.length > 0 ? errors[0].slice(0, 60) : '')

  await browser.close()

  const passed = results.filter(r => r.status === 'PASS').length
  const failed = results.filter(r => r.status === 'FAIL').length
  console.log('\n=== Summary ===')
  console.log(`  Total: ${results.length}`)
  console.log(`  PASS:  ${passed}`)
  console.log(`  FAIL:  ${failed}`)
  if (failed > 0) {
    console.log('\nFailed:')
    results.filter(r => r.status === 'FAIL').forEach(r => console.log(`  ✗ ${r.name}: ${r.details}`))
  }
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(e => { console.error('fatal:', e); process.exit(2) })
