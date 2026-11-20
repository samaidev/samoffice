// e2e_round50.mjs — round50 三问题验证
// 问题1：查找栏 ↑/↓ 选条目时正文滚动到对应匹配位置（selection + scrollIntoView）
// 问题2：标题栏空白处 mousedown 触发 WailsInvoke('drag')（模拟 Wails runtime）
// 问题3：文档标签 ✕ 关闭按钮 cursor 为 default（非手形）
import { chromium } from 'playwright'

const OFFICE = 'http://127.0.0.1:18400'
const results = []
const ok = (name, pass, info = '') => results.push([name, !!pass, String(info).slice(0, 100)])

async function main() {
  const browser = await chromium.launch({ args: ['--no-sandbox'] })
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } })
  const page = await ctx.newPage()

  // 模拟 Wails runtime：记录 WailsInvoke 调用（问题2 验证拖动消息）
  await page.addInitScript(() => {
    window.__wailsInvokes = []
    window.WailsInvoke = (msg) => { window.__wailsInvokes.push(msg) }
  })

  await page.goto(OFFICE, { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(1500)
  await page.evaluate(() => { localStorage.setItem('samoffice_lang', 'zh') })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)

  // ── 准备：Files 菜单新建文档 ──────────────────────────────────
  await page.locator('[data-testid="menu-files"]').click()
  await page.waitForTimeout(400)
  await page.locator('text=📝').first().click() // 新建文档（fileItems 第一项）
  await page.waitForTimeout(800)
  const docTabCount = await page.locator('[data-testid="tab-document"]').count()
  ok('PRE 文档 tab 出现', docTabCount >= 1, `count=${docTabCount}`)

  // 在标题栏空白处（避开 button/tab/input）mousedown+mousemove。
  // 用 elementFromPoint 扫描 header 中线，找第一个非交互元素落点。
  const header = page.locator('header').first()
  const hBox = await header.boundingBox()
  let blankPoint = null
  const blank = hBox ? await page.evaluate((hb) => {
    const y = hb.y + hb.height / 2
    for (let x = hb.x + 8; x < hb.x + hb.width - 8; x += 8) {
      const el = document.elementFromPoint(x, y)
      if (el && !el.closest('button,select,input,[data-testid^="tab-"]')) return { x, y }
    }
    return null
  }, hBox) : null
  if (blank) {
    await page.mouse.move(blank.x, blank.y)
    await page.mouse.down()
    await page.mouse.move(blank.x + 40, blank.y + 10, { steps: 3 })
    await page.mouse.up()
    await page.waitForTimeout(400)
    const invokes = await page.evaluate(() => window.__wailsInvokes)
    ok('B1 标题栏空白 mousedown 触发 drag 消息', invokes.includes('drag'), JSON.stringify(invokes).slice(0, 60))
    // B2 用同一空白点双击
    blankPoint = blank
  } else {
    ok('B1 标题栏空白 mousedown 触发 drag 消息', false, 'no blank point in header')
    blankPoint = null
  }

  // 双击标题栏：第一次 mousedown detail=1 触发一次 drag（OS 语义），
  // 第二次 detail=2 被拦截 —— 整个双击周期 delta 应恰为 1
  const before = await page.evaluate(() => window.__wailsInvokes.length)
  if (blankPoint) {
    await page.mouse.dblclick(blankPoint.x, blankPoint.y)
    await page.waitForTimeout(300)
  }
  const after = await page.evaluate(() => window.__wailsInvokes.length)
  // 双击 = 两次 mousedown：第一次 detail=1（触发 drag 一次，正常），第二次
  // detail=2（应被拦截）。所以整个双击周期 delta 应恰为 1。
  ok('B2 双击标题栏第二次 mousedown 被拦截（delta=1）', after - before === 1, `delta=${after - before}`)

  // ── 问题3：tab ✕ 光标 ─────────────────────────────────────────
  // 有文档打开后应存在 tab；hover ✕ 验证 computed cursor
  const tabClose = page.locator('[data-testid="tab-document"] > span:has-text("✕")').first()
  if (await tabClose.count() > 0) {
    await tabClose.hover()
    await page.waitForTimeout(200)
    const cursor = await tabClose.evaluate(el => getComputedStyle(el).cursor)
    ok('C1 tab ✕ hover 光标为 default（非手形）', cursor === 'default', `cursor=${cursor}`)
  } else {
    ok('C1 tab ✕ hover 光标为 default（非手形）', false, 'no tab found')
  }

  // ── 问题1：查找导航定位 ─────────────────────────────────────────
  // 造多匹配文本（跨屏距离），开查找栏，验证 ↓/↑ 导航后 active 高亮
  // 移到正确匹配且滚入视口（PM 无焦点时 DOM selection 不同步，
  // 以用户可见的 active 高亮位置为准）
  const editor = page.locator('.ProseMirror').first()
  if (await editor.count() > 0) {
    await editor.click()
    await page.waitForTimeout(300)
    await page.keyboard.type('第一个目标词alpha。')
    await page.keyboard.press('Enter')
    for (let i = 0; i < 30; i++) { await page.keyboard.press('Enter') }
    await page.keyboard.type('第二个目标词beta。')
    for (let i = 0; i < 30; i++) { await page.keyboard.press('Enter') }
    await page.keyboard.type('第三个目标词gamma。')

    await page.locator('[data-testid="doc-search-toggle"]').click()
    await page.waitForTimeout(400)
    const findInput = page.locator('input[placeholder*="查找"]').first()
    if (await findInput.count() > 0) {
      await findInput.click()
      await page.keyboard.type('目标词')
      await page.keyboard.press('Enter') // handleSearch → doSearch → gotoMatch(0)
      await page.waitForTimeout(600)

      // 读当前 active 匹配的上下文（父段落文本）+ 可见性
      // 可见性以编辑器滚动容器的视口为准（scroller 只占窗口一部分，
      // 用 window.innerHeight 会把容器外区域误算成可见）
      const readActive = () => page.evaluate(() => {
        const act = document.querySelector('.search-match-active')
        if (!act) return { ctx: '', visible: false, info: 'no active' }
        const r = act.getBoundingClientRect()
        let el = act
        while (el && !(el.scrollHeight > el.clientHeight + 2)) el = el.parentElement
        const sc = el ? el.getBoundingClientRect() : null
        const visible = sc ? r.top >= sc.top && r.bottom <= sc.bottom && r.height > 0 : false
        let blk = act.parentElement
        while (blk && getComputedStyle(blk).display === 'inline') blk = blk.parentElement
        return {
          ctx: (blk ? blk.textContent : '').slice(0, 20),
          visible,
          info: 'r=' + Math.round(r.top) + '..' + Math.round(r.bottom) + ' sc=' + (sc ? Math.round(sc.top) + '..' + Math.round(sc.bottom) : 'none'),
        }
      })
      const count = await page.evaluate(() => {
        const spans = [...document.querySelectorAll('span')]
        const m = spans.find(sp => /[0-9]+\/[0-9]+/.test(sp.textContent))
        return m ? m.textContent : ''
      })
      ok('A0 找到 3 个匹配', count === '1/3', count)

      const st0 = await readActive()
      ok('A1 初始搜索定位第一个匹配（alpha 段）', st0.ctx.includes('第一个'), JSON.stringify(st0))
      ok('A2 初始匹配在视口内', st0.visible, st0.info)

      await page.locator('button:has-text("↓")').first().click()
      await page.waitForTimeout(500)
      const st1 = await readActive()
      ok('A3 ↓ 后 active 移到第二个匹配（beta 段）', st1.ctx.includes('第二个'), JSON.stringify(st1))
      ok('A4 ↓ 后匹配滚入视口（beta 在 30 段后）', st1.visible, st1.info)

      await page.locator('button:has-text("↓")').first().click()
      await page.waitForTimeout(500)
      const st2 = await readActive()
      ok('A5 再 ↓ 到第三个匹配（gamma 段）', st2.ctx.includes('第三个'), JSON.stringify(st2))

      await page.locator('button:has-text("↑")').first().click()
      await page.waitForTimeout(500)
      const st3 = await readActive()
      ok('A6 ↑ 回到第二个匹配', st3.ctx.includes('第二个'), JSON.stringify(st3))
      ok('A7 ↑ 后匹配在视口内', st3.visible, st3.info)
    } else {
      ok('A0 找到 3 个匹配', false, 'find bar not opened')
    }
  } else {
    ok('A0 找到 3 个匹配', false, 'no editor')
  }

  await page.screenshot({ path: '/home/z/my-project/samoffice/scripts/e2e/round50-shots/final.png' })
  await browser.close()

  console.log('\n=== round50 E2E 结果 ===')
  let fail = 0
  for (const [name, pass, info] of results) {
    console.log(`${pass ? '✓' : '✗'} ${name}${pass ? '' : ' —— ' + info}`)
    if (!pass) fail++
  }
  console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(e => { console.error(e); process.exit(2) })
