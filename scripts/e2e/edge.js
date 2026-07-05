// GoOffice 边缘情况测试套件
// 覆盖：API 边缘、容错、安全、并发、UI 边缘
const { firefox } = require('playwright')
const fs = require('fs')
const path = require('path')

const BASE_URL = 'http://127.0.0.1:18500'
const SHOTS_DIR = path.join(__dirname, 'screenshots', 'edge')
fs.mkdirSync(SHOTS_DIR, { recursive: true })

const results = []
function log(name, status, details = '') {
  const icon = status === 'PASS' ? '✓' : status === 'FAIL' ? '✗' : '→'
  console.log(`  ${icon} [${status}] ${name}${details ? ' - ' + details.slice(0, 100) : ''}`)
  results.push({ name, status, details })
}

// HTTP 工具
async function http(method, path, body, headers = {}) {
  try {
    const opts = { method, headers: { 'Content-Type': 'application/json', ...headers } }
    if (body !== undefined && body !== null) {
      if (body instanceof FormData) {
        // FormData 不设 Content-Type，让浏览器自动设置
        delete opts.headers['Content-Type']
        opts.body = body
      } else if (typeof body === 'string') {
        opts.body = body
      } else {
        opts.body = JSON.stringify(body)
      }
    }
    const r = await fetch(`${BASE_URL}${path}`, opts)
    const text = await r.text()
    let data
    try { data = JSON.parse(text) } catch { data = text }
    return { status: r.status, ok: r.ok, data, headers: r.headers, raw: text, size: text.length }
  } catch (e) {
    return { error: e.message, status: 0, ok: false }
  }
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(SHOTS_DIR, name + '.png') })
}

// === 1. API 边缘测试 ===
async function testAPIEdge() {
  console.log('\n=== 1. API 边缘测试 ===')

  // 1.1 空文本拼写检查
  let r = await http('GET', '/api/dict/check?text=&lang=en')
  log('空文本拼写检查', r.status === 200 && Array.isArray(r.data?.errors) ? 'PASS' : 'FAIL', `status=${r.status}`)

  // 1.2 超长文本（10万字符）
  const longText = 'hello '.repeat(20000)
  r = await http('GET', `/api/dict/check?text=${encodeURIComponent(longText)}&lang=en`)
  log('超长文本 10 万字符', r.status === 200 ? 'PASS' : 'FAIL', `status=${r.status}, errors=${r.data?.errors?.length}`)

  // 1.3 Unicode 特殊字符（emoji、零宽、RTL）
  const unicodeText = 'Hello 👋 世界 🌍 \u200B\u200C\u200D test \u202E'
  r = await http('GET', `/api/dict/check?text=${encodeURIComponent(unicodeText)}&lang=en`)
  log('Unicode emoji/零宽/RTL', r.status === 200 ? 'PASS' : 'FAIL', `status=${r.status}`)

  // 1.4 SQL 注入尝试
  r = await http('GET', `/api/dict/check?text='; DROP TABLE user_dict;--&lang=en`)
  log('SQL 注入文本', r.status === 200 ? 'PASS' : 'FAIL', `status=${r.status}`)

  // 1.5 XSS 尝试
  r = await http('GET', `/api/dict/check?text=<script>alert(1)</script>&lang=en`)
  log('XSS 文本', r.status === 200 ? 'PASS' : 'FAIL', `status=${r.status}`)

  // 1.6 未知语言
  r = await http('GET', '/api/dict/check?text=hello&lang=xx')
  log('未知语言', r.status === 200 && r.data?.errors?.length === 0 ? 'PASS' : 'FAIL', `status=${r.status}`)

  // 1.7 缺少 text 参数
  r = await http('GET', '/api/dict/check?lang=en')
  log('缺少 text 参数', r.status === 200 ? 'PASS' : 'FAIL', `status=${r.status}`)

  // 1.8 缺少 lang 参数
  r = await http('GET', `/api/dict/check?text=hello`)
  log('缺少 lang 参数', r.status === 200 ? 'PASS' : 'FAIL', `status=${r.status}, default lang used`)

  // 1.9 用户词库学习 - 空词
  r = await http('POST', '/api/dict/learn', { word: '', lang: 'en', source: 'manual' })
  log('学习空词', r.status === 200 ? 'PASS' : 'FAIL', `status=${r.status}`)

  // 1.10 用户词库学习 - 超长词
  r = await http('POST', '/api/dict/learn', { word: 'a'.repeat(10000), lang: 'en', source: 'manual' })
  log('学习超长词 1 万字符', r.status === 200 ? 'PASS' : 'FAIL', `status=${r.status}`)

  // 1.11 用户词库学习 - SQL 注入
  r = await http('POST', '/api/dict/learn', { word: "'; DROP TABLE--", lang: 'en', source: 'manual' })
  log('学习 SQL 注入词', r.status === 200 ? 'PASS' : 'FAIL', `status=${r.status}`)
  // 验证表还在
  r = await http('GET', '/api/dict/suggest?word=hello&lang=en&n=1')
  log('SQL 注入后表仍可用', r.status === 200 ? 'PASS' : 'FAIL', `status=${r.status}`)

  // 1.12 suggest 无 n 参数
  r = await http('GET', '/api/dict/suggest?word=helo&lang=en')
  log('suggest 无 n 参数', r.status === 200 ? 'PASS' : 'FAIL', `status=${r.status}`)

  // 1.13 suggest n 为负数
  r = await http('GET', '/api/dict/suggest?word=helo&lang=en&n=-5')
  log('suggest n=-5', r.status === 200 ? 'PASS' : 'FAIL', `status=${r.status}`)

  // 1.14 suggest n 为非数字
  r = await http('GET', '/api/dict/suggest?word=helo&lang=en&n=abc')
  log('suggest n=abc', r.status === 200 ? 'PASS' : 'FAIL', `status=${r.status}`)

  // 1.15 不存在的 API
  r = await http('GET', '/api/nonexistent')
  log('不存在的 API', r.status === 404 ? 'PASS' : 'FAIL', `status=${r.status}`)

  // 1.16 错误的 HTTP method
  r = await http('DELETE', '/api/dict/check?text=hello&lang=en')
  log('错误 HTTP method', r.status === 404 || r.status === 405 ? 'PASS' : 'FAIL', `status=${r.status}`)

  // 1.17 保存空文档
  r = await http('POST', '/api/doc/save', { meta: { title: '' }, blocks: [] })
  log('保存空文档', r.status === 200 ? 'PASS' : 'FAIL', `status=${r.status}, type=${r.headers?.get('content-type')}`)

  // 1.18 保存无 blocks 字段
  r = await http('POST', '/api/doc/save', { meta: { title: 'test' } })
  log('保存无 blocks 字段', r.status === 200 ? 'PASS' : 'FAIL', `status=${r.status}`)

  // 1.19 保存无效 JSON 结构
  r = await http('POST', '/api/doc/save', 'not json', { 'Content-Type': 'application/json' })
  log('保存非法 JSON', r.status === 400 ? 'PASS' : 'FAIL', `status=${r.status}`)

  // 1.20 PDF 导出 - 空文档
  r = await http('POST', '/api/doc/export-pdf', { meta: { title: '' }, blocks: [] })
  log('PDF 导出空文档', r.status === 200 && r.headers?.get('content-type') === 'application/pdf' ? 'PASS' : 'FAIL', `status=${r.status}`)

  // 1.21 PDF 导出 - 超长标题
  r = await http('POST', '/api/doc/export-pdf', { meta: { title: 'A'.repeat(1000) }, blocks: [{ inline: [{ content: 'test' }], style: '', align: '' }] })
  log('PDF 导出超长标题', r.status === 200 ? 'PASS' : 'FAIL', `status=${r.status}`)

  // 1.22 本地文件打开 - 不存在路径
  r = await http('GET', '/api/doc/local?path=/nonexistent/file.docx')
  log('打开不存在文件', r.status === 404 ? 'PASS' : 'FAIL', `status=${r.status}`)

  // 1.23 本地文件打开 - 路径遍历
  r = await http('GET', '/api/doc/local?path=../../../../etc/passwd')
  log('路径遍历攻击', r.status === 404 || r.status === 400 || r.status === 422 ? 'PASS' : 'FAIL', `status=${r.status}`)

  // 1.24 本地文件打开 - 无 path 参数
  r = await http('GET', '/api/doc/local')
  log('本地打开无 path', r.status === 400 ? 'PASS' : 'FAIL', `status=${r.status}`)
}

// === 2. docx 容错测试 ===
async function testDocxFaultTolerance() {
  console.log('\n=== 2. docx 容错测试 ===')

  // 2.1 上传非 docx 文件
  const txtContent = 'This is a plain text file, not a docx'
  const txtBlob = new Blob([txtContent], { type: 'text/plain' })
  const fd1 = new FormData()
  fd1.append('file', txtBlob, 'test.txt')
  let r = await http('POST', '/api/doc/open', fd1, {})
  log('上传 txt 文件', r.status === 422 || r.status === 400 ? 'PASS' : 'FAIL', `status=${r.status}`)

  // 2.2 上传空文件
  const emptyBlob = new Blob([new Uint8Array(0)], { type: 'application/octet-stream' })
  const fd2 = new FormData()
  fd2.append('file', emptyBlob, 'empty.docx')
  r = await http('POST', '/api/doc/open', fd2, {})
  log('上传空文件', r.status === 422 || r.status === 400 ? 'PASS' : 'FAIL', `status=${r.status}`)

  // 2.3 上传随机字节（伪装 docx）
  const randomBytes = new Uint8Array(1024)
  for (let i = 0; i < 1024; i++) randomBytes[i] = Math.floor(Math.random() * 256)
  const randBlob = new Blob([randomBytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
  const fd3 = new FormData()
  fd3.append('file', randBlob, 'fake.docx')
  r = await http('POST', '/api/doc/open', fd3, {})
  log('上传随机字节伪装 docx', r.status === 422 || r.status === 400 ? 'PASS' : 'FAIL', `status=${r.status}`)

  // 2.4 上传无 file 字段
  r = await http('POST', '/api/doc/open', new FormData(), {})
  log('上传无 file 字段', r.status === 400 ? 'PASS' : 'FAIL', `status=${r.status}`)

  // 2.5 上传有效 docx（验证正常流程）
  if (fs.existsSync('/tmp/test.docx')) {
    const docxBuffer = fs.readFileSync('/tmp/test.docx')
    const docxBlob = new Blob([docxBuffer], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
    const fd5 = new FormData()
    fd5.append('file', docxBlob, 'test.docx')
    r = await http('POST', '/api/doc/open', fd5, {})
    log('上传有效 docx', r.status === 200 && r.data?.document ? 'PASS' : 'FAIL', `status=${r.status}`)
  }

  // 2.6 上传 xlsx
  if (fs.existsSync('/tmp/test.xlsx')) {
    const xlsxBuffer = fs.readFileSync('/tmp/test.xlsx')
    const xlsxBlob = new Blob([xlsxBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const fd6 = new FormData()
    fd6.append('file', xlsxBlob, 'test.xlsx')
    r = await http('POST', '/api/doc/open', fd6, {})
    log('上传 xlsx', r.status === 200 ? 'PASS' : 'FAIL', `status=${r.status}`)
  }

  // 2.7 上传 pptx
  if (fs.existsSync('/tmp/test.pptx')) {
    const pptxBuffer = fs.readFileSync('/tmp/test.pptx')
    const pptxBlob = new Blob([pptxBuffer], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })
    const fd7 = new FormData()
    fd7.append('file', pptxBlob, 'test.pptx')
    r = await http('POST', '/api/doc/open', fd7, {})
    log('上传 pptx', r.status === 200 ? 'PASS' : 'FAIL', `status=${r.status}`)
  }

  // 2.8 zip 炸弹测试（小规模：1KB 解压成 100KB）
  // 用一个高压缩比的 zip 伪装 docx
  const zipBombContent = 'A'.repeat(100000)
  // 这个测试需要构造特殊 zip，简化：直接用大文本文件伪装
  const bigTxtBlob = new Blob([zipBombContent], { type: 'text/plain' })
  const fd8 = new FormData()
  fd8.append('file', bigTxtBlob, 'bomb.docx')
  r = await http('POST', '/api/doc/open', fd8, {})
  log('大文本伪装 docx', r.status === 422 || r.status === 400 ? 'PASS' : 'FAIL', `status=${r.status}`)
}

// === 3. 词库边缘测试 ===
async function testDictEdge() {
  console.log('\n=== 3. 词库边缘测试 ===')

  // 3.1 纯标点
  let r = await http('GET', `/api/dict/check?text=${encodeURIComponent('!@#$%^&*()')}&lang=en`)
  log('纯标点', r.status === 200 ? 'PASS' : 'FAIL', `errors=${r.data?.errors?.length}`)

  // 3.2 纯数字
  r = await http('GET', `/api/dict/check?text=${encodeURIComponent('12345 67890')}&lang=en`)
  log('纯数字', r.status === 200 ? 'PASS' : 'FAIL', `errors=${r.data?.errors?.length}`)

  // 3.3 混合中英文
  r = await http('GET', `/api/dict/check?text=${encodeURIComponent('Hello 世界 helo 你好')}&lang=en`)
  log('混合中英文 EN 模式', r.status === 200 ? 'PASS' : 'FAIL', `errors=${r.data?.errors?.length}`)

  // 3.4 混合中英文 ZH 模式
  r = await http('GET', `/api/dict/check?text=${encodeURIComponent('Hello 世界 helo 你好')}&lang=zh`)
  log('混合中英文 ZH 模式', r.status === 200 ? 'PASS' : 'FAIL', `errors=${r.data?.errors?.length}`)

  // 3.5 全大写
  r = await http('GET', `/api/dict/check?text=${encodeURIComponent('HELLO WORRD')}&lang=en`)
  log('全大写', r.status === 200 ? 'PASS' : 'FAIL', `errors=${r.data?.errors?.length}`)

  // 3.6 单字符
  r = await http('GET', `/api/dict/check?text=a&lang=en`)
  log('单字符', r.status === 200 ? 'PASS' : 'FAIL', `errors=${r.data?.errors?.length}`)

  // 3.7 含连字符的词
  r = await http('GET', `/api/dict/check?text=well-known&lang=en`)
  log('含连字符词', r.status === 200 ? 'PASS' : 'FAIL', `errors=${r.data?.errors?.length}`)

  // 3.8 含撇号的词
  r = await http('GET', `/api/dict/check?text=${encodeURIComponent("don't can't")}&lang=en`)
  log('含撇号词', r.status === 200 ? 'PASS' : 'FAIL', `errors=${r.data?.errors?.length}`)

  // 3.9 日文字符
  r = await http('GET', `/api/dict/check?text=${encodeURIComponent('こんにちは')}&lang=en`)
  log('日文字符 EN 模式', r.status === 200 ? 'PASS' : 'FAIL', `errors=${r.data?.errors?.length}`)

  // 3.10 韩文字符
  r = await http('GET', `/api/dict/check?text=${encodeURIComponent('안녕하세요')}&lang=en`)
  log('韩文字符 EN 模式', r.status === 200 ? 'PASS' : 'FAIL', `errors=${r.data?.errors?.length}`)

  // 3.11 阿拉伯文（RTL）
  r = await http('GET', `/api/dict/check?text=${encodeURIComponent('مرحبا')}&lang=en`)
  log('阿拉伯文 EN 模式', r.status === 200 ? 'PASS' : 'FAIL', `errors=${r.data?.errors?.length}`)

  // 3.12 表情符号
  r = await http('GET', `/api/dict/check?text=${encodeURIComponent('Hello 😀🎉 World')}&lang=en`)
  log('含 emoji', r.status === 200 ? 'PASS' : 'FAIL', `errors=${r.data?.errors?.length}`)

  // 3.13 零宽字符
  r = await http('GET', `/api/dict/check?text=hel${encodeURIComponent('\u200B')}lo&lang=en`)
  log('含零宽字符', r.status === 200 ? 'PASS' : 'FAIL', `errors=${r.data?.errors?.length}`)

  // 3.14 suggest 空词
  r = await http('GET', `/api/dict/suggest?word=&lang=en&n=5`)
  log('suggest 空词', r.status === 200 ? 'PASS' : 'FAIL', `status=${r.status}`)
}

// === 4. 并发测试 ===
async function testConcurrency() {
  console.log('\n=== 4. 并发测试 ===')

  // 4.1 10 个并发拼写检查
  const promises = []
  for (let i = 0; i < 10; i++) {
    promises.push(http('GET', `/api/dict/check?text=helo${i}%20worrd&lang=en`))
  }
  const results10 = await Promise.all(promises)
  const allOk = results10.every(r => r.status === 200)
  log('10 并发拼写检查', allOk ? 'PASS' : 'FAIL', `${results10.filter(r => r.status === 200).length}/10 ok`)

  // 4.2 5 个并发用户词库学习
  const learnPromises = []
  for (let i = 0; i < 5; i++) {
    learnPromises.push(http('POST', '/api/dict/learn', { word: `concurrent${i}`, lang: 'en', source: 'test' }))
  }
  const learnResults = await Promise.all(learnPromises)
  log('5 并发学习词库', learnResults.every(r => r.status === 200) ? 'PASS' : 'FAIL',
    `${learnResults.filter(r => r.status === 200).length}/5 ok`)

  // 4.3 并发 docx 导出
  const exportPromises = []
  for (let i = 0; i < 5; i++) {
    exportPromises.push(http('POST', '/api/doc/save', {
      meta: { title: `concurrent${i}` },
      blocks: [{ inline: [{ content: `test${i}` }], style: '', align: '' }]
    }))
  }
  const exportResults = await Promise.all(exportPromises)
  log('5 并发 docx 导出', exportResults.every(r => r.status === 200) ? 'PASS' : 'FAIL',
    `${exportResults.filter(r => r.status === 200).length}/5 ok`)

  // 4.4 同一词快速重复学习（频率累加）
  await http('POST', '/api/dict/learn', { word: 'repeatword', lang: 'en', source: 'test' })
  await http('POST', '/api/dict/learn', { word: 'repeatword', lang: 'en', source: 'test' })
  await http('POST', '/api/dict/learn', { word: 'repeatword', lang: 'en', source: 'test' })
  // 验证不再报错
  r = await http('GET', `/api/dict/check?text=repeatword&lang=en`)
  log('重复学习同一词', r.data?.errors?.length === 0 ? 'PASS' : 'FAIL', `errors=${r.data?.errors?.length}`)
}

// === 5. 前端 UI 边缘测试 ===
async function testUIEdge() {
  console.log('\n=== 5. 前端 UI 边缘测试 ===')
  const browser = await firefox.launch()
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await ctx.newPage()

  const consoleErrors = []
  page.on('pageerror', e => consoleErrors.push(e.message))

  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(500)

    // 5.1 快速切换 Tab 10 次
    for (let i = 0; i < 10; i++) {
      await page.click('button:has-text("表格")')
      await page.click('button:has-text("演示")')
      await page.click('button:has-text("文档")')
    }
    const pmVisible = await page.locator('.ProseMirror').isVisible()
    log('快速切换 Tab 30 次', pmVisible && consoleErrors.length === 0 ? 'PASS' : 'FAIL',
      consoleErrors.length > 0 ? consoleErrors[0].slice(0, 60) : 'no errors')

    // 5.2 超长文本输入（5000 字符）
    await page.click('.ProseMirror')
    await page.selectOption('select', 'en')
    const longText = 'hello world '.repeat(500)
    await page.keyboard.type(longText)
    await page.waitForTimeout(1000)
    const pmText = await page.locator('.ProseMirror').textContent()
    log('超长文本输入 5000 字符', pmText.length > 1000 ? 'PASS' : 'FAIL', `len=${pmText.length}`)
    await shot(page, 'edge-long-text')

    // 5.3 粘贴特殊字符 - 用 clipboard API
    await page.keyboard.press('Control+A')
    await page.keyboard.press('Delete')
    await page.waitForTimeout(200)
    // 用 Playwright 的 keyboard type 输入特殊字符（模拟粘贴）
    await page.keyboard.type('Test <script>alert(1)</script> & emoji 😀 特殊字符')
    await page.waitForTimeout(500)
    const afterPaste = await page.locator('.ProseMirror').textContent()
    log('粘贴特殊字符', afterPaste.includes('Test') ? 'PASS' : 'FAIL', `len=${afterPaste.length}`)
    await shot(page, 'edge-paste-special')

    // 5.4 移动端响应式 - 切换到移动端 viewport
    await page.setViewportSize({ width: 375, height: 667 })
    await page.waitForTimeout(500)
    const hamburgerVisible = await page.locator('header button').first().isVisible()
    log('移动端 375px 汉堡菜单', hamburgerVisible ? 'PASS' : 'FAIL')

    // 5.5 移动端汉堡菜单展开
    await page.locator('header button').first().click()
    await page.waitForTimeout(300)
    const menuVisible = await page.locator('text=打开文件').first().isVisible()
    log('移动端菜单展开', menuVisible ? 'PASS' : 'FAIL')
    await shot(page, 'edge-mobile-menu')

    // 5.6 移动端表格
    await page.click('button:has-text("表格")')
    await page.waitForTimeout(500)
    const tableMobileVisible = await page.locator('table').isVisible()
    log('移动端表格可见', tableMobileVisible ? 'PASS' : 'FAIL')
    await shot(page, 'edge-mobile-table')

    // 5.7 移动端演示
    await page.click('button:has-text("演示")')
    await page.waitForTimeout(500)
    const slideMobileVisible = await page.locator('input[placeholder*="标题"]').first().isVisible()
    log('移动端演示可见', slideMobileVisible ? 'PASS' : 'FAIL')

    // 5.8 超小尺寸 320px
    await page.setViewportSize({ width: 320, height: 568 })
    await page.waitForTimeout(300)
    const noOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth <= document.documentElement.clientWidth + 5
    })
    log('320px 超小尺寸无溢出', noOverflow ? 'PASS' : 'FAIL', `scrollW=${await page.evaluate(() => document.documentElement.scrollWidth)}`)

    // 5.9 切回桌面端正常
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.waitForTimeout(300)
    const desktopOk = await page.locator('header button').count()
    log('切回桌面端恢复', desktopOk >= 4 ? 'PASS' : 'FAIL', `${desktopOk} buttons`)

    // 5.10 Console 错误检查
    log('UI 测试无 pageerror', consoleErrors.length === 0 ? 'PASS' : 'FAIL',
      consoleErrors.length > 0 ? consoleErrors[0].slice(0, 80) : '')

  } catch (e) {
    log('UI 边缘测试异常', 'FAIL', e.message.slice(0, 80))
  } finally {
    await browser.close()
  }
}

// === 6. 导出边缘测试 ===
async function testExportEdge() {
  console.log('\n=== 6. 导出边缘测试 ===')

  // 6.1 docx 含特殊字符
  let r = await http('POST', '/api/doc/save', {
    meta: { title: 'Test<>&"' },
    blocks: [{ inline: [{ content: 'Test<>&"\'\n\t特殊字符' }], style: '', align: '' }]
  })
  log('docx 含特殊字符', r.status === 200 ? 'PASS' : 'FAIL', `status=${r.status}`)

  // 6.2 docx 含 emoji
  r = await http('POST', '/api/doc/save', {
    meta: { title: 'Emoji 😀' },
    blocks: [{ inline: [{ content: 'Hello 😀🎉 World' }], style: '', align: '' }]
  })
  log('docx 含 emoji', r.status === 200 ? 'PASS' : 'FAIL', `status=${r.status}`)

  // 6.3 docx 含嵌套结构
  r = await http('POST', '/api/doc/save', {
    meta: { title: 'Nested' },
    blocks: [
      { level: 1, inline: [{ content: 'H1' }] },
      { level: 2, inline: [{ content: 'H2' }] },
      { inline: [{ content: 'Bold', bold: true }, { content: ' ' }, { content: 'Italic', italic: true }] },
      { items: [[{ inline: [{ content: 'item1' }], style: '', align: '' }], [{ inline: [{ content: 'item2' }], style: '', align: '' }]], ordered: false },
      { code: 'console.log("hi")' },
      { rows: [[{ inline: [{ content: 'A1' }], isHeader: true }]] }
    ]
  })
  log('docx 嵌套结构', r.status === 200 ? 'PASS' : 'FAIL', `status=${r.status}`)

  // 6.4 PDF 含中文
  r = await http('POST', '/api/doc/export-pdf', {
    meta: { title: '中文 PDF' },
    blocks: [
      { level: 1, inline: [{ content: '中文标题' }] },
      { inline: [{ content: '这是一段中文内容，测试 PDF 渲染。' }] },
      { items: [[{ inline: [{ content: '项目一' }], style: '', align: '' }]], ordered: false }
    ]
  })
  log('PDF 含中文', r.status === 200 ? 'PASS' : 'FAIL', `status=${r.status}`)

  // 6.5 PDF 超大文档（100 个段落）
  const blocks = []
  for (let i = 0; i < 100; i++) {
    blocks.push({ inline: [{ content: `Paragraph ${i}: ${'Lorem ipsum '.repeat(10)}` }], style: '', align: '' })
  }
  r = await http('POST', '/api/doc/export-pdf', { meta: { title: 'Large' }, blocks })
  log('PDF 100 段落', r.status === 200 ? 'PASS' : 'FAIL', `status=${r.status}, size=${r.raw?.length}`)

  // 6.6 docx 超大文档（100 个段落）
  r = await http('POST', '/api/doc/save', { meta: { title: 'Large' }, blocks })
  log('docx 100 段落', r.status === 200 ? 'PASS' : 'FAIL', `status=${r.status}, size=${r.raw?.length}`)
}

// === main ===
// 等待服务就绪
async function waitForServer(maxWait = 60000) {
  const start = Date.now()
  while (Date.now() - start < maxWait) {
    try {
      const r = await fetch(`${BASE_URL}/api/health`)
      if (r.ok) return true
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 2000))
  }
  return false
}

async function main() {
  console.log(`GoOffice 边缘测试套件 → ${BASE_URL}`)
  console.log('等待服务就绪...')
  const ready = await waitForServer()
  if (!ready) {
    console.error('服务未就绪，退出')
    process.exit(2)
  }
  console.log('服务就绪，开始测试')

  // 先跑非 UI 测试（轻量）
  await testAPIEdge()
  await testDocxFaultTolerance()
  await testDictEdge()
  await testConcurrency()
  await testExportEdge()

  // UI 测试单独跑（重量级，最后跑避免内存峰值影响其他测试）
  await testUIEdge()

  const passed = results.filter(r => r.status === 'PASS').length
  const failed = results.filter(r => r.status === 'FAIL').length
  console.log('\n=== Summary ===')
  console.log(`  Total: ${results.length}`)
  console.log(`  PASS:  ${passed}`)
  console.log(`  FAIL:  ${failed}`)
  console.log(`  Pass rate: ${(passed / (passed + failed) * 100).toFixed(1)}%`)

  if (failed > 0) {
    console.log('\nFailed:')
    results.filter(r => r.status === 'FAIL').forEach(r => {
      console.log(`  ✗ ${r.name}: ${r.details}`)
    })
  }
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(e => { console.error('fatal:', e); process.exit(2) })
