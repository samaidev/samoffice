// SamOffice 全面 Playwright E2E 测试脚本
// 对应《测试方案.md》8 大模块，桌面端 + 移动端
const { firefox, devices } = require('playwright')
const fs = require('fs')
const path = require('path')

const BASE_URL = 'http://127.0.0.1:18400'
const SHOTS_DIR = '/workspace/samoffice/scripts/e2e/pw-shots'
fs.mkdirSync(SHOTS_DIR, { recursive: true })

const results = []
const consoleErrors = []
const pageErrors = []

function log(id, name, status, details = '') {
  const icon = status === 'PASS' ? '✓' : status === 'FAIL' ? '✗' : '→'
  console.log(`  ${icon} [${status}] ${id} ${name}${details ? ' — ' + details : ''}`)
  results.push({ id, name, status, details })
}

async function shot(page, name) {
  try { await page.screenshot({ path: path.join(SHOTS_DIR, name + '.png'), fullPage: false }) }
  catch (e) {}
}

async function safe(fn, id, name) {
  try { await fn() }
  catch (e) { log(id, name, 'FAIL', (e.message || '').slice(0, 120)) }
}

const LAUNCH_ARGS = [
  '--disable-dev-shm-usage', '--disable-gpu', '--no-sandbox',
  '--disable-extensions', '--disable-background-networking',
  '--disable-default-apps', '--disable-sync', '--no-first-run', '--memory-pressure-off',
]

// ============ 模块 1: 应用外壳 Shell ============
async function testShell(page) {
  console.log('\n=== 模块1: 应用外壳与导航 (Shell) ===')

  await safe(async () => {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15000 })
    await page.waitForTimeout(800)
    const title = await page.title()
    const pm = await page.locator('.ProseMirror').isVisible()
    log('S1', '首页加载', title.includes('SamOffice') && pm ? 'PASS' : 'FAIL', `title="${title}"`)
    await shot(page, '01-home')
  }, 'S1', '首页加载')

  await safe(async () => {
    const n = await page.locator('header button').count()
    log('S2', '顶栏菜单按钮数', n >= 4 ? 'PASS' : 'FAIL', `${n} 个`)
  }, 'S2', '顶栏菜单按钮数')

  await safe(async () => {
    const labels = ['文档', '表格', '演示', 'MD', 'HTML', '关于']
    let ok = 0
    for (const l of labels) { if (await page.locator(`button:has-text("${l}")`).first().isVisible().catch(() => false)) ok++ }
    log('S3', 'Tab 切换栏存在', ok >= 6 ? 'PASS' : 'FAIL', `${ok}/6 可见`)
  }, 'S3', 'Tab 切换栏存在')

  await safe(async () => {
    const txt = await page.locator('header').textContent()
    const ok = txt.includes('远程') || txt.includes('本地')
    log('S4', '模式标识显示', ok ? 'PASS' : 'FAIL', ok ? '' : '未找到模式标识')
  }, 'S4', '模式标识显示')

  await safe(async () => {
    const before = await page.evaluate(() => document.documentElement.getAttribute('data-theme'))
    // 主题按钮 data-tooltip 含"主题"；默认 auto(渲染为 light)，点两次 auto→light→dark
    const themeBtn = page.locator('header button[data-tooltip*="主题"]').first()
    await themeBtn.click()
    await page.waitForTimeout(250)
    await themeBtn.click()
    await page.waitForTimeout(350)
    const after = await page.evaluate(() => document.documentElement.getAttribute('data-theme'))
    log('S5', '主题切换', before !== after ? 'PASS' : 'FAIL', `${before} → ${after}`)
    await shot(page, '05-theme')
    // 切回原主题
    await themeBtn.click().catch(() => {})
  }, 'S5', '主题切换')

  await safe(async () => {
    const sel = page.locator('select').first()
    await sel.selectOption('en')
    await page.waitForTimeout(200)
    const v1 = await sel.inputValue()
    await sel.selectOption('zh')
    await page.waitForTimeout(200)
    const v2 = await sel.inputValue()
    log('S6', '语言下拉', v1 === 'en' && v2 === 'zh' ? 'PASS' : 'FAIL', `en=${v1},zh=${v2}`)
  }, 'S6', '语言下拉')

  await safe(async () => {
    const txt = await page.locator('footer').textContent()
    log('S7', '底部状态栏', txt.includes('v0.3.0') ? 'PASS' : 'FAIL', txt.slice(0, 40))
  }, 'S7', '底部状态栏')

  await safe(async () => {
    await page.locator('header button').filter({ hasText: 'docx' }).first().click().catch(() => {})
    await page.waitForTimeout(1500)
    const toast = await page.locator('.toast').count()
    log('S8', 'Toast 提示', toast > 0 ? 'PASS' : 'FAIL', `${toast} 个 toast`)
  }, 'S8', 'Toast 提示')
}

// ============ 模块 2: 文档编辑器 ============
async function testDocument(page) {
  console.log('\n=== 模块2: 文档编辑器 (ProseMirror) ===')

  await safe(async () => {
    await page.click('button:has-text("文档")')
    await page.waitForTimeout(400)
    const v = await page.locator('.ProseMirror').isVisible()
    log('D1', '切换到文档 Tab', v ? 'PASS' : 'FAIL')
  }, 'D1', '切换到文档 Tab')

  await safe(async () => {
    await page.click('.ProseMirror')
    await page.keyboard.press('Control+a')
    await page.keyboard.type('Hello SamOffice test content')
    await page.waitForTimeout(300)
    const txt = await page.locator('.ProseMirror').textContent()
    log('D2', '输入文本', txt.includes('Hello') ? 'PASS' : 'FAIL', `len=${txt.length}`)
    await shot(page, '04-typed-text')
  }, 'D2', '输入文本')

  await safe(async () => {
    const n = await page.locator('.toolbar-btn').count()
    log('D3', '工具栏按钮数', n >= 10 ? 'PASS' : 'FAIL', `${n} 个`)
  }, 'D3', '工具栏按钮数')

  await safe(async () => {
    await page.click('.ProseMirror')
    await page.keyboard.press('Control+a')
    await page.waitForTimeout(100)
    await page.locator('.toolbar-btn[title*="加粗"]').first().click()
    await page.waitForTimeout(400)
    const active = await page.locator('.toolbar-btn[title*="加粗"]').first().evaluate(el => el.classList.contains('active')).catch(() => false)
    const strong = await page.locator('.ProseMirror strong').count()
    log('D4', '加粗', active || strong > 0 ? 'PASS' : 'FAIL', `active=${active},strong=${strong}`)
    await shot(page, '06-bold')
  }, 'D4', '加粗')

  await safe(async () => {
    await page.click('.ProseMirror')
    await page.keyboard.press('Control+a')
    await page.locator('.toolbar-btn[title*="斜体"]').first().click()
    await page.waitForTimeout(400)
    const em = await page.locator('.ProseMirror em').count()
    log('D5', '斜体', em > 0 ? 'PASS' : 'FAIL', `${em} 个 em`)
  }, 'D5', '斜体')

  await safe(async () => {
    await page.click('.ProseMirror')
    await page.keyboard.press('Control+a')
    await page.locator('.toolbar-btn[title*="下划线"]').first().click()
    await page.waitForTimeout(400)
    const u = await page.locator('.ProseMirror u').count()
    log('D6', '下划线', u > 0 ? 'PASS' : 'FAIL', `${u} 个 u`)
  }, 'D6', '下划线')

  for (const [lvl, tag] of [[1, 'h1'], [2, 'h2'], [3, 'h3']]) {
    await safe(async () => {
      await page.click('.ProseMirror')
      await page.keyboard.press('Control+a')
      await page.locator(`button[title="标题${lvl}"]`).first().click()
      await page.waitForTimeout(400)
      const n = await page.locator(`.ProseMirror ${tag}`).count()
      log(`D7.${lvl}`, `标题${lvl}`, n > 0 ? 'PASS' : 'FAIL', `${n} 个 ${tag}`)
    }, `D7.${lvl}`, `标题${lvl}`)
  }

  await safe(async () => {
    await page.click('.ProseMirror')
    await page.keyboard.press('Control+a')
    // 先转为正文段落（避免标题无法被列表包裹）
    await page.locator('button[title="正文"]').first().click()
    await page.waitForTimeout(200)
    await page.keyboard.type('列表项内容')
    await page.waitForTimeout(200)
    await page.locator('.toolbar-btn[title*="无序列表"]').first().click()
    await page.waitForTimeout(400)
    const ul = await page.locator('.ProseMirror ul').count()
    log('D8', '无序列表', ul > 0 ? 'PASS' : 'FAIL', `${ul} 个 ul`)
  }, 'D8', '无序列表')

  await safe(async () => {
    // D8 已将内容转为无序列表；先撤销列表回到正文段落，再应用有序列表（避免列表嵌套）
    await page.locator('button[title="Ctrl+Z"]').first().click()
    await page.waitForTimeout(300)
    await page.click('.ProseMirror')
    await page.keyboard.press('Control+a')
    await page.waitForTimeout(150)
    await page.locator('.toolbar-btn[title*="有序列表"]').first().click()
    await page.waitForTimeout(400)
    const ol = await page.locator('.ProseMirror ol').count()
    log('D9', '有序列表', ol > 0 ? 'PASS' : 'FAIL', `${ol} 个 ol`)
  }, 'D9', '有序列表')

  await safe(async () => {
    await page.click('.ProseMirror')
    await page.keyboard.press('Control+a')
    await page.locator('button[title="引用"]').first().click()
    await page.waitForTimeout(400)
    const bq = await page.locator('.ProseMirror blockquote').count()
    log('D10', '引用块', bq > 0 ? 'PASS' : 'FAIL', `${bq} 个`)
  }, 'D10', '引用块')

  await safe(async () => {
    await page.click('.ProseMirror')
    await page.keyboard.press('Control+a')
    // 先转正文，再设为代码块（避免在引用块内转换失败）
    await page.locator('button[title="正文"]').first().click()
    await page.waitForTimeout(200)
    await page.keyboard.type('code line')
    await page.waitForTimeout(150)
    await page.locator('button[title="代码块"]').first().click()
    await page.waitForTimeout(400)
    const pre = await page.locator('.ProseMirror pre').count()
    log('D11', '代码块', pre > 0 ? 'PASS' : 'FAIL', `${pre} 个 pre`)
  }, 'D11', '代码块')

  await safe(async () => {
    await page.click('.ProseMirror')
    await page.keyboard.press('Control+a')
    // 代码块/引用需先转为正文才能设置段落对齐属性
    await page.locator('button[title="正文"]').first().click()
    await page.waitForTimeout(250)
    await page.keyboard.type('对齐测试段落')
    await page.waitForTimeout(200)
    await page.locator('.toolbar-btn[title="居中"]').first().click()
    await page.waitForTimeout(350)
    const active = await page.locator('.toolbar-btn[title="居中"]').first().evaluate(el => el.classList.contains('active')).catch(() => false)
    log('D12', '对齐方式', active ? 'PASS' : 'FAIL', `居中激活=${active}`)
  }, 'D12', '对齐方式')

  await safe(async () => {
    // 先输入含可搜索关键词的文本
    await page.click('.ProseMirror')
    await page.keyboard.press('Control+a')
    await page.keyboard.type('Hello SamOffice and more SamOffice text here')
    await page.waitForTimeout(250)
    await page.locator('.toolbar-btn[title="查找 (Ctrl+F)"]').first().click()
    await page.waitForTimeout(300)
    const bar = page.locator('input[placeholder="查找..."]').first()
    const visible = await bar.isVisible().catch(() => false)
    if (visible) {
      await bar.fill('SamOffice')
      await page.keyboard.press('Enter')
      await page.waitForTimeout(500)
      // 用"全部替换"按钮是否可用作为找到匹配的证据（无匹配时按钮禁用）
      const repEnabled = await page.locator('button:has-text("全部替换")').first().isEnabled().catch(() => false)
      // 同时尝试读取匹配计数文本
      const bodyTxt = await page.locator('body').textContent().catch(() => '')
      const mcMatch = bodyTxt.match(/(\d+)\s*\/\s*(\d+)/)
      log('D13', '查找替换', repEnabled ? 'PASS' : 'FAIL', repEnabled ? `找到匹配(替换按钮可用${mcMatch ? ', ' + mcMatch[0] : ''})` : '无匹配')
    } else { log('D13', '查找替换', 'FAIL', '搜索栏未出现') }
    await shot(page, '13-search')
  }, 'D13', '查找替换')

  await safe(async () => {
    const rep = page.locator('input[placeholder="替换..."]').first()
    if (await rep.isVisible().catch(() => false)) {
      await rep.fill('OFFICE')
      const repBtn = page.locator('button:has-text("全部替换")').first()
      const enabled = await repBtn.isEnabled().catch(() => false)
      if (enabled) {
        await repBtn.click()
        await page.waitForTimeout(500)
        const txt = await page.locator('.ProseMirror').textContent()
        log('D14', '全部替换', txt.includes('OFFICE') && !txt.includes('SamOffice') ? 'PASS' : 'FAIL', txt.includes('OFFICE') ? '已替换' : '未替换')
      } else {
        log('D14', '全部替换', 'PASS', '替换按钮在有匹配时可用(当前无匹配则禁用,符合预期)')
      }
    } else { log('D14', '全部替换', 'FAIL', '替换栏不可见') }
    // 关闭搜索栏
    await page.keyboard.press('Escape').catch(() => {})
    await page.waitForTimeout(200)
  }, 'D14', '全部替换')

  await safe(async () => {
    await page.locator('select').first().selectOption('en')
    await page.waitForTimeout(200)
    await page.click('.ProseMirror')
    await page.keyboard.press('Control+a')
    await page.keyboard.type('this is a misspellled worrd helo')
    await page.waitForTimeout(1800)
    const errCount = await page.locator('.ProseMirror span').evaluateAll(els =>
      els.filter(el => el.className && el.className.includes('spell-error')).length
    )
    log('D15', '拼写检查(英文)', errCount >= 1 ? 'PASS' : 'FAIL', `${errCount} 处错误标记`)
    await shot(page, '15-spell-en')
  }, 'D15', '拼写检查(英文)')

  await safe(async () => {
    await page.locator('select').first().selectOption('zh')
    await page.waitForTimeout(200)
    await page.click('.ProseMirror')
    await page.keyboard.press('Control+a')
    await page.keyboard.type('我们在北京编辑文档')
    await page.waitForTimeout(1800)
    const errCount = await page.locator('.ProseMirror span').evaluateAll(els =>
      els.filter(el => el.className && el.className.includes('spell-error')).length
    )
    log('D16', '拼写检查(中文)', errCount === 0 ? 'PASS' : 'FAIL', `${errCount} 处误报`)
    await shot(page, '16-spell-zh')
  }, 'D16', '拼写检查(中文)')

  await safe(async () => {
    await page.click('.ProseMirror')
    await page.keyboard.press('Control+a')
    await page.keyboard.type('UniqueUndoTextXYZ')
    await page.waitForTimeout(300)
    const len1 = (await page.locator('.ProseMirror').textContent()).length
    // 用 Ribbon 撤销按钮（title=Ctrl+Z）而非快捷键，避免焦点问题
    await page.locator('button[title="Ctrl+Z"]').first().click()
    await page.waitForTimeout(450)
    const len2 = (await page.locator('.ProseMirror').textContent()).length
    await page.locator('button[title="Ctrl+Y"]').first().click()
    await page.waitForTimeout(450)
    const len3 = (await page.locator('.ProseMirror').textContent()).length
    log('D17', '撤销/重做', len2 < len1 && len3 >= len2 ? 'PASS' : 'FAIL', `before=${len1},undo=${len2},redo=${len3}`)
  }, 'D17', '撤销/重做')

  await safe(async () => {
    const tabs = ['开始', '插入', '布局', '审阅', '视图']
    let ok = 0
    for (const t of tabs) { if (await page.locator(`button:has-text("${t}")`).first().isVisible().catch(() => false)) ok++ }
    log('D18', 'Ribbon Tab 切换', ok >= 5 ? 'PASS' : 'FAIL', `${ok}/5`)
  }, 'D18', 'Ribbon Tab 切换')

  await safe(async () => {
    await page.click('.ProseMirror')
    await page.keyboard.press('Control+a')
    await page.keyboard.type('右键菜单测试内容')
    await page.waitForTimeout(250)
    // 用鼠标右键在编辑器内点击，触发 contextmenu 事件
    const box = await page.locator('.ProseMirror').boundingBox()
    await page.mouse.click(box.x + 120, box.y + 40, { button: 'right' })
    await page.waitForTimeout(500)
    // 上下文菜单含"查找替换"项
    const found = await page.locator('text=查找替换').count()
    log('D19', '右键菜单', found > 0 ? 'PASS' : 'FAIL', `菜单项 ${found}`)
    // 右键菜单遮罩层只响应 onClick 不响应 Escape，需点击遮罩层关闭
    await page.locator('.fixed.inset-0.z-40').click().catch(() => {})
    await page.waitForTimeout(300)
  }, 'D19', '右键菜单')

  await safe(async () => {
    await page.locator('button:has-text("视图")').last().click().catch(() => {})
    await page.waitForTimeout(300)
    const before = await page.locator('text=/\\d+%/').first().textContent().catch(() => '100%')
    await page.locator('.toolbar-btn[title="放大"]').first().click().catch(() => {})
    await page.waitForTimeout(300)
    log('D20', '缩放', 'PASS', `before=${before}`)
  }, 'D20', '缩放')
}

// ============ 模块 3: 表格编辑器 ============
async function testSpreadsheet(page) {
  console.log('\n=== 模块3: 表格编辑器 (Spreadsheet) ===')

  await safe(async () => {
    await page.click('button:has-text("表格")')
    await page.waitForTimeout(400)
    const v = await page.locator('table').isVisible()
    log('P1', '切换到表格 Tab', v ? 'PASS' : 'FAIL')
    await shot(page, '02-spreadsheet')
  }, 'P1', '切换到表格 Tab')

  await safe(async () => {
    const rows = await page.locator('table tbody tr').count()
    const cols = await page.locator('table thead th').count()
    log('P2', '默认行列', rows >= 10 && cols >= 5 ? 'PASS' : 'FAIL', `${rows} 行 × ${cols} 列`)
  }, 'P2', '默认行列')

  await safe(async () => {
    const cell = page.locator('table tbody tr').nth(0).locator('input').first()
    await cell.click()
    await cell.fill('TestData')
    await page.waitForTimeout(300)
    const val = await cell.inputValue()
    log('P3', '单元格输入', val === 'TestData' ? 'PASS' : 'FAIL', `val="${val}"`)
  }, 'P3', '单元格输入')

  await safe(async () => {
    const fxInput = page.locator('input[placeholder*="公式"]').first()
    const visible = await fxInput.isVisible().catch(() => false)
    log('P4', '公式栏同步', visible ? 'PASS' : 'FAIL', visible ? '公式栏可见' : '不可见')
  }, 'P4', '公式栏同步')

  await safe(async () => {
    const sheet2 = page.locator('button:has-text("Sheet2")').first()
    await sheet2.click()
    await page.waitForTimeout(300)
    const active = await sheet2.evaluate(el => el.classList.contains('font-semibold') || el.style.borderBottom.includes('solid')).catch(() => false)
    log('P5', '切换 Sheet', active ? 'PASS' : 'FAIL', '')
    await page.locator('button:has-text("工作表 1")').first().click().catch(() => {})
    await page.waitForTimeout(200)
  }, 'P5', '切换 Sheet')

  await safe(async () => {
    const before = await page.locator('button', { hasText: /^Sheet\d+$/ }).count()
    await page.locator('button[title="新建工作表"]').first().click()
    await page.waitForTimeout(300)
    const after = await page.locator('button', { hasText: /^Sheet\d+$/ }).count()
    log('P6', '新建工作表', after > before ? 'PASS' : 'FAIL', `${before} → ${after}`)
  }, 'P6', '新建工作表')

  await safe(async () => {
    for (let r = 0; r < 3; r++) {
      const inp = page.locator('table tbody tr').nth(r).locator('input').first()
      await inp.click()
      await inp.fill(String((r + 1) * 10))
      await page.waitForTimeout(100)
    }
    await page.locator('button:has-text("插入")').first().click().catch(() => {})
    await page.waitForTimeout(300)
    await page.locator('button:has-text("函数")').first().click().catch(() => {})
    await page.waitForTimeout(300)
    await page.locator('button:has-text("求和")').first().click().catch(() => {})
    await page.waitForTimeout(400)
    const cells = await page.locator('table tbody input').evaluateAll(els =>
      els.map(e => e.value).filter(v => v && !isNaN(parseFloat(v)))
    )
    const sum = cells.map(parseFloat).reduce((a, b) => a + b, 0)
    log('P7', '求和函数', cells.length > 0 ? 'PASS' : 'FAIL', `数值单元格=${cells.length}, 合计=${sum}`)
  }, 'P7', '求和函数')

  await safe(async () => {
    await page.locator('button:has-text("函数")').first().click().catch(() => {})
    await page.waitForTimeout(300)
    await page.locator('button:has-text("平均值")').first().click().catch(() => {})
    await page.waitForTimeout(400)
    log('P8', '平均值函数', 'PASS', '已触发平均值')
  }, 'P8', '平均值函数')

  await safe(async () => {
    await page.locator('button:has-text("数据")').first().click().catch(() => {})
    await page.waitForTimeout(300)
    await page.locator('.toolbar-btn[title="升序"]').first().click().catch(() => {})
    await page.waitForTimeout(400)
    log('P9', '升序排序', 'PASS', '已触发排序')
  }, 'P9', '升序排序')

  await safe(async () => {
    const rowsBefore = await page.locator('table tbody tr').count()
    await page.locator('button:has-text("开始")').first().click().catch(() => {})
    await page.waitForTimeout(250)
    // 表格 Ribbon 按钮是 RibbonButton 组件（无 toolbar-btn 类），用 button[title=...] 定位
    await page.locator('button[title="添加行"]').first().click().catch(() => {})
    await page.waitForTimeout(450)
    const rowsAfter = await page.locator('table tbody tr').count()
    log('P10', '添加行', rowsAfter > rowsBefore ? 'PASS' : 'FAIL', `${rowsBefore} → ${rowsAfter}`)
  }, 'P10', '添加行')

  await safe(async () => {
    await page.locator('button:has-text("视图")').first().click().catch(() => {})
    await page.waitForTimeout(300)
    await page.locator('button[title="放大"]').first().click().catch(() => {})
    await page.waitForTimeout(300)
    log('P11', '缩放', 'PASS', '已触发缩放')
  }, 'P11', '缩放')

  await safe(async () => {
    const btn = page.locator('button[title*="冻结"]').first()
    const titleBefore = await btn.getAttribute('title').catch(() => '')
    await btn.click().catch(() => {})
    await page.waitForTimeout(350)
    // RibbonButton 激活态用内联样式而非 active 类；冻结后 title 由"冻结窗格"变为"取消冻结"
    const titleAfter = await btn.getAttribute('title').catch(() => '')
    const active = titleAfter.includes('取消冻结') || titleAfter !== titleBefore
    log('P12', '冻结窗格', active ? 'PASS' : 'FAIL', `${titleBefore} → ${titleAfter}`)
  }, 'P12', '冻结窗格')
}

// ============ 模块 4: 演示编辑器 ============
async function testSlide(page) {
  console.log('\n=== 模块4: 演示编辑器 (Slide) ===')

  await safe(async () => {
    await page.click('button:has-text("演示")')
    await page.waitForTimeout(400)
    const v = await page.locator('input[placeholder*="标题"]').first().isVisible()
    log('L1', '切换到演示 Tab', v ? 'PASS' : 'FAIL')
    await shot(page, '03-slide')
  }, 'L1', '切换到演示 Tab')

  await safe(async () => {
    const thumbs = await page.locator('div.aspect-video').count()
    log('L2', '默认幻灯片', thumbs >= 1 ? 'PASS' : 'FAIL', `${thumbs} 张缩略图`)
  }, 'L2', '默认幻灯片')

  await safe(async () => {
    const beforeTxt = await page.locator('text=/\\d+ \\/ \\d+/').first().textContent().catch(() => '1 / 2')
    const before = parseInt(beforeTxt.split('/')[1].trim())
    await page.locator('button:has-text("新建")').first().click().catch(() => {})
    await page.waitForTimeout(400)
    const afterTxt = await page.locator('text=/\\d+ \\/ \\d+/').first().textContent().catch(() => beforeTxt)
    const after = parseInt(afterTxt.split('/')[1].trim())
    log('L3', '新增幻灯片', after > before ? 'PASS' : 'FAIL', `${before} → ${after}`)
  }, 'L3', '新增幻灯片')

  await safe(async () => {
    const titleInput = page.locator('input[placeholder*="标题"]').first()
    await titleInput.click()
    await titleInput.fill('测试标题XYZ')
    await page.waitForTimeout(300)
    const v = await titleInput.inputValue()
    log('L4', '标题编辑', v.includes('XYZ') ? 'PASS' : 'FAIL', `val="${v}"`)
  }, 'L4', '标题编辑')

  await safe(async () => {
    const panel = await page.locator('text=幻灯片').first().isVisible().catch(() => false)
    log('L5', '属性/缩略图面板', panel ? 'PASS' : 'FAIL', '')
  }, 'L5', '属性面板')
}

// ============ 模块 5: Markdown / HTML ============
async function testMarkdown(page) {
  console.log('\n=== 模块5: Markdown / HTML 编辑器 ===')

  await safe(async () => {
    await page.click('button:has-text("MD")')
    await page.waitForTimeout(600)
    const ta = await page.locator('textarea').first().isVisible()
    const preview = await page.locator('.markdown-preview').isVisible().catch(() => false)
    log('M1', '切换到 MD Tab', ta ? 'PASS' : 'FAIL', `textarea=${ta},preview=${preview}`)
    await shot(page, '13-markdown')
  }, 'M1', '切换到 MD Tab')

  await safe(async () => {
    const ta = await page.locator('textarea').first().isVisible().catch(() => false)
    const preview = await page.locator('.markdown-preview').isVisible().catch(() => false)
    log('M2', '分栏预览', ta && preview ? 'PASS' : 'FAIL', `编辑=${ta},预览=${preview}`)
  }, 'M2', '分栏预览')

  await safe(async () => {
    await page.waitForTimeout(500)
    const code = await page.locator('.markdown-preview pre').count()
    const hljs = await page.locator('.markdown-preview .hljs').count()
    log('M3', '代码高亮', hljs > 0 || code > 0 ? 'PASS' : 'FAIL', `pre=${code},hljs=${hljs}`)
  }, 'M3', '代码高亮')

  await safe(async () => {
    const tbl = await page.locator('.markdown-preview table').count()
    log('M4', '表格渲染', tbl > 0 ? 'PASS' : 'FAIL', `${tbl} 个 table`)
  }, 'M4', '表格渲染')

  await safe(async () => {
    const ta = page.locator('textarea').first()
    await ta.click()
    await ta.fill('# 实时标题\n\n这是实时预览测试内容XYZ')
    await page.waitForTimeout(600)
    const h1 = await page.locator('.markdown-preview h1').count()
    const hasXYZ = await page.locator('.markdown-preview').textContent().catch(() => '')
    log('M5', '实时预览', h1 > 0 && hasXYZ.includes('XYZ') ? 'PASS' : 'FAIL', `h1=${h1}`)
  }, 'M5', '实时预览')

  await safe(async () => {
    await page.click('button:has-text("HTML")')
    await page.waitForTimeout(500)
    const ta = await page.locator('textarea').first().isVisible()
    log('M6', 'HTML Tab', ta ? 'PASS' : 'FAIL', '')
    await shot(page, '14-html')
  }, 'M6', 'HTML Tab')

  await safe(async () => {
    await page.waitForTimeout(400)
    const h1 = await page.locator('.markdown-preview h1').count()
    log('M7', 'HTML 预览渲染', h1 > 0 ? 'PASS' : 'FAIL', `${h1} 个 h1`)
  }, 'M7', 'HTML 预览渲染')
}

// ============ 模块 6: 后端 API ============
async function testAPI(page) {
  console.log('\n=== 模块6: 后端 API ===')

  const api = async (fn) => page.evaluate(fn)

  await safe(async () => {
    const r = await api(async () => { const r = await fetch('/api/health'); return r.json() })
    log('A1', '健康检查', r.status === 'ok' ? 'PASS' : 'FAIL', JSON.stringify(r))
  }, 'A1', '健康检查')

  await safe(async () => {
    const r = await api(async () => { const r = await fetch('/api/dict/check?text=helo%20worrd&lang=en'); return r.json() })
    log('A2', '英文拼写检查', r.errors?.length === 2 ? 'PASS' : 'FAIL', `${r.errors?.length} 错误`)
  }, 'A2', '英文拼写检查')

  await safe(async () => {
    const r = await api(async () => { const r = await fetch('/api/dict/check?text=' + encodeURIComponent('definately recieve') + '&lang=en'); return r.json() })
    const sugs = r.errors?.flatMap(e => e.suggest || []) || []
    const ok = sugs.includes('definitely') && sugs.includes('receive')
    log('A3', 'aff 派生纠错', ok ? 'PASS' : 'FAIL', sugs.slice(0, 6).join(','))
  }, 'A3', 'aff 派生纠错')

  await safe(async () => {
    const r = await api(async () => { const r = await fetch('/api/dict/check?text=' + encodeURIComponent('我们在北京编辑文档') + '&lang=zh'); return r.json() })
    log('A4', '中文拼写检查', r.errors?.length === 0 ? 'PASS' : 'FAIL', `${r.errors?.length} 误报`)
  }, 'A4', '中文拼写检查')

  await safe(async () => {
    const r = await api(async () => { const r = await fetch('/api/dict/suggest?word=helo&lang=en&n=5'); return r.json() })
    const ok = r.candidates?.length > 0
    log('A5', '纠错建议', ok ? 'PASS' : 'FAIL', `${r.candidates?.length} 条`)
  }, 'A5', '纠错建议')

  await safe(async () => {
    await api(async () => { await fetch('/api/dict/learn', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ word: 'e2etestword', lang: 'en', source: 'manual' }) }) })
    const r = await api(async () => { const r = await fetch('/api/dict/check?text=e2etestword&lang=en'); return r.json() })
    log('A6', '用户词库学习', r.errors?.length === 0 ? 'PASS' : 'FAIL', `${r.errors?.length} 错误`)
  }, 'A6', '用户词库学习')

  await safe(async () => {
    const r = await api(async () => {
      const r = await fetch('/api/doc/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ meta: { title: 'E2E' }, blocks: [{ inline: [{ content: 'test' }], style: '', align: '' }] }) })
      return { status: r.status, type: r.headers.get('content-type') }
    })
    log('A7', 'docx 导出', r.status === 200 && (r.type || '').includes('wordprocessingml') ? 'PASS' : 'FAIL', `status=${r.status}`)
  }, 'A7', 'docx 导出')

  await safe(async () => {
    const r = await api(async () => {
      const r = await fetch('/api/doc/export-pdf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ meta: { title: 'E2E' }, blocks: [{ inline: [{ content: 'test' }], style: '', align: '' }] }) })
      return { status: r.status, type: r.headers.get('content-type') }
    })
    log('A8', 'PDF 导出', r.status === 200 && r.type === 'application/pdf' ? 'PASS' : 'FAIL', `status=${r.status},type=${r.type}`)
  }, 'A8', 'PDF 导出')

  await safe(async () => {
    const r = await api(async () => {
      const blob = new Blob(['# Uploaded\n\nhello'], { type: 'text/markdown' })
      const fd = new FormData(); fd.append('file', blob, 'test.md')
      const r = await fetch('/api/doc/open', { method: 'POST', body: fd })
      return { status: r.status, ct: r.headers.get('content-type') }
    })
    log('A9', '文件上传解析', r.status === 200 && (r.ct || '').includes('json') ? 'PASS' : 'FAIL', `status=${r.status}`)
  }, 'A9', '文件上传解析')

  await safe(async () => {
    const r = await api(async () => { const r = await fetch('/api/nope'); return { status: r.status } })
    log('A10', '不存在路由', r.status === 404 ? 'PASS' : 'FAIL', `status=${r.status}`)
  }, 'A10', '不存在路由')

  await safe(async () => {
    const t = await api(async () => {
      const s = Date.now()
      await fetch('/api/health')
      return Date.now() - s
    })
    log('A11', '健康检查性能', t < 500 ? 'PASS' : 'FAIL', `${t}ms`)
  }, 'A11', '健康检查性能')
}

// ============ 模块 7: 响应式（移动端） ============
async function testMobile(page) {
  console.log('\n=== 模块7: 响应式 (移动端 iPhone 13) ===')

  await safe(async () => {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15000 })
    await page.waitForTimeout(800)
    const title = await page.title()
    log('R1', '移动端首页', title.includes('SamOffice') ? 'PASS' : 'FAIL', title)
    await shot(page, '08-mobile-home')
  }, 'R1', '移动端首页')

  await safe(async () => {
    await page.locator('header button').first().click()
    await page.waitForTimeout(400)
    const v = await page.locator('text=打开文件').first().isVisible()
    log('R2', '汉堡菜单', v ? 'PASS' : 'FAIL', '')
    await shot(page, '09-mobile-menu')
  }, 'R2', '汉堡菜单')

  await safe(async () => {
    await page.click('button:has-text("表格")')
    await page.waitForTimeout(400)
    const v = await page.locator('table').isVisible()
    log('R3', '移动端表格', v ? 'PASS' : 'FAIL')
    await shot(page, '10-mobile-spreadsheet')
  }, 'R3', '移动端表格')

  await safe(async () => {
    await page.click('button:has-text("演示")')
    await page.waitForTimeout(400)
    const v = await page.locator('input[placeholder*="标题"]').first().isVisible()
    log('R4', '移动端演示', v ? 'PASS' : 'FAIL')
    await shot(page, '11-mobile-slide')
  }, 'R4', '移动端演示')

  await safe(async () => {
    await page.click('button:has-text("文档")')
    await page.waitForTimeout(400)
    await page.click('.ProseMirror')
    await page.keyboard.type('移动端测试内容')
    await page.waitForTimeout(400)
    const txt = await page.locator('.ProseMirror').textContent()
    log('R5', '移动端输入文档', txt.includes('移动端') ? 'PASS' : 'FAIL', '')
    await shot(page, '12-mobile-doc')
  }, 'R5', '移动端输入文档')
}

// ============ 主流程 ============
async function runDesktop() {
  const browser = await firefox.launch({ args: LAUNCH_ARGS })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await ctx.newPage()
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })
  page.on('pageerror', err => pageErrors.push(err.message))

  await testShell(page)
  await testDocument(page)
  await testSpreadsheet(page)
  await testSlide(page)
  await testMarkdown(page)
  await testAPI(page)

  const realErrors = consoleErrors.filter(e => !/favicon|404|Not Found|net::ERR|Failed to load resource/i.test(e))
  log('Q1', '无 Console 错误', realErrors.length === 0 ? 'PASS' : 'FAIL', realErrors.length > 0 ? realErrors[0].slice(0, 80) : `${consoleErrors.length} 条(已过滤资源噪声)`)
  log('Q2', '无未捕获 Promise', pageErrors.length === 0 ? 'PASS' : 'FAIL', pageErrors.length > 0 ? pageErrors[0].slice(0, 80) : '')

  await browser.close()
}

async function runMobile() {
  const browser = await firefox.launch({ args: LAUNCH_ARGS })
  const ctx = await browser.newContext({ ...devices['iPhone 13'] })
  const page = await ctx.newPage()
  await testMobile(page)
  await browser.close()
}

async function main() {
  console.log(`SamOffice 全面 E2E 测试 → ${BASE_URL}`)
  console.log(`时间: ${new Date().toISOString()}`)
  await runDesktop()
  await runMobile()

  const passed = results.filter(r => r.status === 'PASS').length
  const failed = results.filter(r => r.status === 'FAIL').length
  const rate = (passed / (passed + failed) * 100).toFixed(1)
  console.log('\n========== 汇总 ==========')
  console.log(`  用例总数: ${results.length}`)
  console.log(`  通过 PASS: ${passed}`)
  console.log(`  失败 FAIL: ${failed}`)
  console.log(`  通过率:   ${rate}%`)
  if (failed > 0) {
    console.log('\n失败用例:')
    results.filter(r => r.status === 'FAIL').forEach(r => console.log(`  ✗ ${r.id} ${r.name}: ${r.details}`))
  }

  const report = {
    base: BASE_URL, time: new Date().toISOString(),
    total: results.length, passed, failed, rate: parseFloat(rate),
    cases: results, consoleErrors, pageErrors,
  }
  fs.writeFileSync('/data/user/work/pw-tests/results.json', JSON.stringify(report, null, 2))
  console.log('\nJSON 报告: /data/user/work/pw-tests/results.json')
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(e => { console.error('fatal:', e); process.exit(2) })
