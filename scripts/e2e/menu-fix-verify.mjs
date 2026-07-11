// menu-fix-verify.mjs
// 验证修复后的二级弹出菜单：click 触发、互斥、点击颜色后关闭、ESC 关闭、外部点击关闭
import { firefox } from 'playwright'
import { mkdirSync } from 'fs'
import { join } from 'path'

const BASE = 'http://127.0.0.1:18400'
const SHOTS = '/home/z/my-project/samoffice/scripts/e2e/pw-shots-verify'
mkdirSync(SHOTS, { recursive: true })

const findings = []
let pass = 0, fail = 0, warn = 0

function record(test, severity, message, context = {}) {
  findings.push({ test, severity, message, context, ts: new Date().toISOString() })
  if (severity === 'pass') pass++
  else if (severity === 'fail') fail++
  else warn++
}

async function countPopups(page) {
  return await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.ribbon-popup')).filter(p => {
      const r = p.getBoundingClientRect()
      const cs = getComputedStyle(p)
      return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden'
    }).length
  })
}

;(async () => {
  const browser = await firefox.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await ctx.newPage()
  page.on('console', m => { if (m.type() === 'error') record('console', 'error', `console.error: ${m.text()}`) })
  page.on('pageerror', e => record('console', 'error', `pageerror: ${e.message}`))

  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(800)

  // === 测试矩阵 ===
  const cases = [
    { editor: 'document', ribbon: 'home', desc: '文字颜色', btnSel: 'button[title*="Color"]' },
    { editor: 'document', ribbon: 'home', desc: '高亮', btnSel: 'button[title*="Highlight"]' },
    { editor: 'document', ribbon: 'layout', desc: '底纹', btnSel: 'button[title*="Shading"]' },
    { editor: 'document', ribbon: 'view', desc: '页面背景', btnSel: 'button[title*="Background"]' },
    { editor: 'spreadsheet', ribbon: 'home', desc: '单元格颜色', btnSel: 'button[title*="Color"]' },
    { editor: 'slide', ribbon: 'home', desc: '演示颜色', btnSel: 'button[title*="Color"]' },
  ]

  for (const c of cases) {
    console.log(`==> ${c.editor}/${c.ribbon} ${c.desc}`)
    // 切到编辑器
    await page.locator(`[data-testid="tab-${c.editor}"]`).click()
    await page.waitForTimeout(400)
    // 切到 ribbon tab
    await page.locator(`[data-testid="ribbon-tab-${c.ribbon}"]`).click()
    await page.waitForTimeout(300)
    // 关闭所有 popup（点空白）
    await page.mouse.click(640, 400)
    await page.waitForTimeout(200)

    const btn = page.locator(c.btnSel).first()
    if (!(await btn.count())) {
      record(c.editor + '-' + c.desc, 'warn', `未找到触发按钮: ${c.btnSel}`)
      continue
    }

    // --- 测试 A: click 触发 ---
    await btn.click()
    await page.waitForTimeout(300)
    const n1 = await countPopups(page)
    if (n1 === 1) record(c.desc + '-click-open', 'pass', 'click 后单个 popup 显示')
    else if (n1 === 0) record(c.desc + '-click-open', 'fail', 'click 后无 popup 显示')
    else record(c.desc + '-click-open', 'fail', `click 后 ${n1} 个 popup 同时显示（应 1 个）`)

    // --- 测试 B: 互斥 — 再点另一个 popup 触发按钮 ---
    // 找另一个有 popup 的按钮（如果有）
    // 这里简单测试：再点同一个按钮应关闭
    await btn.click()
    await page.waitForTimeout(300)
    const n2 = await countPopups(page)
    if (n2 === 0) record(c.desc + '-toggle-close', 'pass', '再次 click 后 popup 关闭')
    else record(c.desc + '-toggle-close', 'fail', `再次 click 后 ${n2} 个 popup 仍显示`)

    // --- 测试 C: click 颜色后自动关闭 ---
    await btn.click()
    await page.waitForTimeout(300)
    const firstColor = page.locator('.ribbon-popup button').first()
    if (await firstColor.count()) {
      await firstColor.click()
      await page.waitForTimeout(400)
      const n3 = await countPopups(page)
      if (n3 === 0) record(c.desc + '-color-click-close', 'pass', '点击颜色后 popup 自动关闭')
      else record(c.desc + '-color-click-close', 'fail', `点击颜色后 ${n3} 个 popup 仍显示`)
    } else {
      record(c.desc + '-color-click-close', 'warn', '未找到颜色按钮（可能 popup 未打开）')
    }

    // --- 测试 D: 外部点击关闭 ---
    await btn.click()
    await page.waitForTimeout(300)
    await page.mouse.click(640, 400)
    await page.waitForTimeout(300)
    const n4 = await countPopups(page)
    if (n4 === 0) record(c.desc + '-outside-click', 'pass', '外部点击后 popup 关闭')
    else record(c.desc + '-outside-click', 'fail', `外部点击后 ${n4} 个 popup 仍显示`)

    // --- 测试 E: ESC 关闭 ---
    await btn.click()
    await page.waitForTimeout(300)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    const n5 = await countPopups(page)
    if (n5 === 0) record(c.desc + '-esc-close', 'pass', 'ESC 后 popup 关闭')
    else record(c.desc + '-esc-close', 'fail', `ESC 后 ${n5} 个 popup 仍显示`)

    // --- 测试 F: 越界检查 ---
    await btn.click()
    await page.waitForTimeout(300)
    const popups = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.ribbon-popup')).filter(p => {
        const r = p.getBoundingClientRect()
        const cs = getComputedStyle(p)
        return r.width > 0 && r.height > 0 && cs.display !== 'none'
      }).map(p => {
        const r = p.getBoundingClientRect()
        return { x: Math.round(r.x), y: Math.round(r.y), right: Math.round(r.right), bottom: Math.round(r.bottom) }
      })
    })
    for (const p of popups) {
      if (p.x < 0 || p.y < 0 || p.right > 1280 || p.bottom > 800) {
        record(c.desc + '-bound', 'fail', `popup 越界: x=${p.x} y=${p.y} right=${p.right} bottom=${p.bottom}`)
      } else {
        record(c.desc + '-bound', 'pass', `popup 在视口内: x=${p.x} y=${p.y} right=${p.right} bottom=${p.bottom}`)
      }
    }
    await page.mouse.click(640, 400)
    await page.waitForTimeout(200)
  }

  // === 测试 G: 切换 ribbon tab 后 popup 关闭 ===
  console.log('==> 切换 ribbon tab 后 popup 关闭')
  await page.locator('[data-testid="tab-document"]').click()
  await page.waitForTimeout(400)
  await page.locator('[data-testid="ribbon-tab-home"]').click()
  await page.waitForTimeout(300)
  await page.locator('button[title*="Color"]').first().click()
  await page.waitForTimeout(300)
  await page.locator('[data-testid="ribbon-tab-insert"]').click()
  await page.waitForTimeout(400)
  const n6 = await countPopups(page)
  if (n6 === 0) record('tab-switch', 'pass', '切换 ribbon tab 后 popup 关闭')
  else record('tab-switch', 'fail', `切换 ribbon tab 后 ${n6} 个 popup 残留`)

  // === 测试 H: 切换编辑器 tab 后 popup 关闭 ===
  console.log('==> 切换编辑器 tab 后 popup 关闭')
  await page.locator('[data-testid="ribbon-tab-home"]').click()
  await page.waitForTimeout(300)
  await page.locator('button[title*="Color"]').first().click()
  await page.waitForTimeout(300)
  await page.locator('[data-testid="tab-spreadsheet"]').click()
  await page.waitForTimeout(400)
  const n7 = await countPopups(page)
  if (n7 === 0) record('editor-switch', 'pass', '切换编辑器 tab 后 popup 关闭')
  else record('editor-switch', 'fail', `切换编辑器 tab 后 ${n7} 个 popup 残留`)

  await browser.close()

  console.log('\n========== 验证汇总 ==========')
  console.log(`通过: ${pass}  失败: ${fail}  警告: ${warn}  总计: ${pass + fail + warn}`)
  if (fail > 0) {
    console.log('\n失败项:')
    findings.filter(f => f.severity === 'fail').forEach(f => console.log(`  ✗ [${f.test}] ${f.message}`))
  }
  if (warn > 0) {
    console.log('\n警告项:')
    findings.filter(f => f.severity === 'warn').forEach(f => console.log(`  ! [${f.test}] ${f.message}`))
  }
  process.exit(fail > 0 ? 1 : 0)
})().catch(e => { console.error('FATAL:', e); process.exit(2) })
