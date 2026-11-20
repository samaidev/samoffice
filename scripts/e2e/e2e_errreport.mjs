// e2e_errreport.mjs — 错误报送端到端验证
// 场景：samoffice web 预览（本地 vite 产物）→ 触发 window.error 崩溃 →
// 覆盖层出现「📤 报送错误」「✕ 关闭页面」按钮 → 报送到本地 mock 的
// admin168 后端（127.0.0.1:18767）→ 验证 error_reports.json 落库 +
// admin168 前端页面渲染「错误上报」卡片。
//
// 域名模拟：samoffice 的 index.html 硬编码 https://samai.cc/admin168/...，
// 本地用 Playwright route 拦截该 URL 转发到 127.0.0.1:18767 —— 等价验证
// 真实链路（CORS preflight + POST 都走同一条 fetch 代码路径）。
import { chromium } from 'playwright'
import { readFileSync, existsSync } from 'fs'

const OFFICE = 'http://127.0.0.1:18400'      // samoffice 预览（go server 静态 dist）
const BACKEND = 'http://127.0.0.1:18767'     // admin168 后端 mock samai.cc
const results = []
const ok = (name, pass, info = '') => results.push([name, !!pass, String(info).slice(0, 120)])

async function main() {
  const browser = await chromium.launch({ args: ['--no-sandbox'] })

  // ── Part A: samoffice 崩溃覆盖层 → 报送 ─────────────────────────
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } })
  const page = await ctx.newPage()
  // 拦截 samai.cc 上报请求 → 转发本地后端（完整保留 method/headers/body）
  await page.route('**/samai.cc/admin168/api/err-reports', route => {
    const url = new URL(route.request().url())
    const target = BACKEND + '/api/err-reports' + url.search
    const headers = { ...route.request().headers() }
    delete headers[':authority']; delete headers[':method']; delete headers[':path']; delete headers[':scheme']
    fetch(target, {
      method: route.request().method(),
      headers,
      body: route.request().postData(),
    }).then(async (res) => {
      await route.fulfill({
        status: res.status,
        headers: Object.fromEntries(res.headers.entries()),
        body: await res.text(),
      })
    }).catch(e => route.abort('failed'))
  })

  await page.goto(OFFICE, { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(1500)
  await page.evaluate(() => { localStorage.setItem('samoffice_lang', 'zh') })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)

  // 触发一个真实的未捕获错误（复刻 search$ 类崩溃路径）
  await page.evaluate(() => {
    setTimeout(() => { null.foo.bar }, 0) // → window.error TypeError
  })
  await page.waitForTimeout(800)

  const overlay = page.locator('#err-overlay')
  ok('A1 崩溃覆盖层出现', await overlay.count() === 1)
  const errText = await overlay.locator('pre').innerText().catch(() => '')
  ok('A2 覆盖层含错误堆栈', errText.includes("TypeError") || errText.includes("null"), errText.split('\n')[0])
  ok('A3 报送按钮存在', await overlay.locator('#err-report-btn').count() === 1)
  ok('A4 关闭按钮存在', await overlay.locator('button', { hasText: '关闭' }).count() >= 1)

  // 点击报送
  await overlay.locator('#err-report-btn').click()
  await page.waitForTimeout(1200)
  const btnText = await overlay.locator('#err-report-btn').innerText()
  ok('A5 报送成功反馈', btnText.includes('已报送'), btnText)

  // 点击关闭 → 覆盖层移除、界面恢复
  await overlay.locator('button', { hasText: '关闭' }).click()
  await page.waitForTimeout(500)
  ok('A6 关闭后覆盖层移除', await page.locator('#err-overlay').count() === 0)
  ok('A7 关闭后应用界面可用', await page.locator('#root').count() === 1)

  await ctx.close()

  // ── Part B: 后端收到记录 ─────────────────────────────────────────
  if (!existsSync('/tmp/errtest3/data/error_reports.json')) {
    ok('B1 落库文件存在', false, 'error_reports.json missing')
  } else {
    const data = JSON.parse(readFileSync('/tmp/errtest3/data/error_reports.json', 'utf-8'))
    const reps = data.reports || []
    const last = reps[reps.length - 1]
    ok('B1 落库文件存在', true)
    ok('B2 记录含版本号', last && /0\.7\.3\d/.test(last.version || ''), last?.version)
    ok('B3 记录含 TypeError 消息', last && (last.message || '').includes('TypeError'), last?.message?.slice(0, 60))
    ok('B4 记录含 stack', last && (last.stack || '').length > 10, `stack len=${(last?.stack || '').length}`)
    ok('B5 记录 kind=window.error', last && last.kind === 'window.error', last?.kind)
  }

  // ── Part C: admin168 前端页面渲染「错误上报」卡 ──────────────────
  // 后端按 cwd/static 提供前端 —— 部署同样的 index.html/i18n.js 后直接访问
  const page2 = await browser.newPage({ viewport: { width: 1360, height: 900 } })
  await page2.goto(BACKEND + '/', { waitUntil: 'networkidle' })
  // 密码获取：外部脚本在重启后端后捕获 bootstrap 密码写入 /tmp/errtest3/auth_pwd.txt；
  // 若无该文件（后端已运行多轮，auth.json 已存在），从日志兜底
  let pass = null
  try { pass = readFileSync('/tmp/errtest3/auth_pwd.txt', 'utf-8').trim() } catch {}
  if (!pass) {
    await page2.fill('#loginPassword', 'bootstrap-trigger-wrong')
    await page2.press('#loginPassword', 'Enter')
    await page2.waitForTimeout(600)
    pass = readFileSync('/tmp/e3.log', 'utf-8').match(/: ([A-Za-z0-9]{16})\s*$/m)?.[1] || null
  }
  if (!pass) { ok('C0 获取测试密码', false, 'no auth_pwd.txt and no bootstrap log') }
  else {
    await page2.fill('#loginPassword', pass)
    await page2.press('#loginPassword', 'Enter')
    await page2.waitForTimeout(1200)
  }
  const bodyText0 = await page2.evaluate(() => document.body.innerText)
  ok('C1 统计卡含「错误上报」', bodyText0.includes('错误上报'), '')
  // 切到「错误上报」分类查看崩溃卡片
  await page2.locator('.stat-card', { hasText: '错误上报' }).first().click()
  await page2.waitForTimeout(800)
  const bodyText = await page2.evaluate(() => document.body.innerText)
  ok('C2 页面含崩溃卡片标题', bodyText.includes('TypeError') || bodyText.includes('null'), bodyText.slice(0, 80))
  ok('C3 卡片含堆栈折叠区', bodyText.includes('堆栈'), '')
  // 展开堆栈并验证内容
  const stackTog = page2.locator('.card-field .key', { hasText: '堆栈' }).first()
  if (await stackTog.count() > 0) {
    await stackTog.click()
    await page2.waitForTimeout(300)
    const expanded = await page2.evaluate(() => document.body.innerText)
    ok('C4 堆栈展开可见内容', expanded.includes('getState') || expanded.includes('null'), '')
  } else {
    ok('C4 堆栈展开可见内容', false, 'no stack toggle found')
  }

  await page2.screenshot({ path: '/home/z/my-project/samoffice/scripts/e2e/errreport-admin168.png' })
  await browser.close()

  console.log('\n=== err-report E2E 结果 ===')
  let fail = 0
  for (const [name, pass, info] of results) {
    console.log(`${pass ? '✓' : '✗'} ${name}${pass ? '' : ' —— ' + info}`)
    if (!pass) fail++
  }
  console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(e => { console.error(e); process.exit(2) })
