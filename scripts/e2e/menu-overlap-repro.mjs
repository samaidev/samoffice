// menu-overlap-repro.mjs
// 激进测试：快速在多个二级按钮间移动鼠标，重现 popup 重叠
import { firefox } from 'playwright'
import { mkdirSync } from 'fs'
import { join } from 'path'

const BASE = 'http://127.0.0.1:18400'
const SHOTS = '/home/z/my-project/samoffice/scripts/e2e/pw-shots-overlap'
mkdirSync(SHOTS, { recursive: true })

const findings = []

;(async () => {
  const browser = await firefox.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await ctx.newPage()
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(800)

  // === 测试 1: 文档编辑器 home tab — 颜色按钮 hover 后立刻移到高亮按钮 ===
  console.log('==> Test 1: document/home 颜色->高亮 快速切换')
  await page.locator('[data-testid="tab-document"]').click()
  await page.waitForTimeout(400)
  await page.locator('[data-testid="ribbon-tab-home"]').click()
  await page.waitForTimeout(300)

  const colorBtn = page.locator('button[title*="Color"]').first()
  const highlightBtn = page.locator('button[title*="Highlight"]').first()
  await colorBtn.hover()
  await page.waitForTimeout(150) // 还没稳定就移走
  await highlightBtn.hover()
  await page.waitForTimeout(500)
  const popups1 = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.ribbon-popup')).filter(p => {
      const r = p.getBoundingClientRect()
      return r.width > 0 && r.height > 0
    }).map(p => {
      const r = p.getBoundingClientRect()
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom) }
    })
  })
  console.log(`  移到高亮后剩 ${popups1.length} 个 popup`)
  if (popups1.length > 1) {
    findings.push({ test: 'doc-color-to-highlight', severity: 'fail', message: `剩 ${popups1.length} 个 popup 同时可见`, popups: popups1 })
    await page.screenshot({ path: join(SHOTS, 'doc-overlap.png') })
  } else if (popups1.length === 1) {
    findings.push({ test: 'doc-color-to-highlight', severity: 'pass', message: '仅 1 个 popup 可见' })
  } else {
    findings.push({ test: 'doc-color-to-highlight', severity: 'warn', message: '无 popup 可见（可能 hover 已离开）' })
  }

  // === 测试 2: 颜色按钮 hover 后点击颜色，确认 popup 是否关闭 ===
  console.log('==> Test 2: 颜色按钮 hover 后点击颜色')
  await page.mouse.click(640, 400) // 先关闭所有
  await page.waitForTimeout(300)
  await colorBtn.hover()
  await page.waitForTimeout(400)
  // 点击第一个颜色
  const firstColor = page.locator('.ribbon-popup button').first()
  if (await firstColor.count()) {
    await firstColor.click()
    await page.waitForTimeout(500)
    const popups2 = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.ribbon-popup')).filter(p => {
        const r = p.getBoundingClientRect()
        return r.width > 0 && r.height > 0
      }).length
    })
    console.log(`  点击颜色后剩 ${popups2} 个 popup`)
    if (popups2 > 0) {
      findings.push({ test: 'doc-color-click-stays', severity: 'fail', message: `点击颜色后 popup 仍打开 (${popups2} 个) — 应自动关闭` })
      await page.screenshot({ path: join(SHOTS, 'doc-color-stays.png') })
    } else {
      findings.push({ test: 'doc-color-click-stays', severity: 'pass', message: '点击颜色后 popup 关闭' })
    }
  }

  // === 测试 3: 表格编辑器 颜色按钮 hover 后点击颜色 ===
  console.log('==> Test 3: spreadsheet 颜色 hover+click')
  await page.locator('[data-testid="tab-spreadsheet"]').click()
  await page.waitForTimeout(500)
  await page.locator('[data-testid="ribbon-tab-home"]').click()
  await page.waitForTimeout(300)
  const ssColorBtn = page.locator('button[title*="Color"]').first()
  if (await ssColorBtn.count()) {
    await ssColorBtn.hover()
    await page.waitForTimeout(400)
    const firstColor = page.locator('.ribbon-popup button').first()
    if (await firstColor.count()) {
      await firstColor.click()
      await page.waitForTimeout(500)
      const popups3 = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('.ribbon-popup')).filter(p => {
          const r = p.getBoundingClientRect()
          return r.width > 0 && r.height > 0
        }).length
      })
      if (popups3 > 0) {
        findings.push({ test: 'sheet-color-click-stays', severity: 'fail', message: `表格颜色 popup 点击后仍打开 (${popups3} 个)` })
        await page.screenshot({ path: join(SHOTS, 'sheet-color-stays.png') })
      } else {
        findings.push({ test: 'sheet-color-click-stays', severity: 'pass', message: '表格颜色 popup 点击后关闭' })
      }
    }
  }

  // === 测试 4: 演示编辑器 颜色按钮 hover 后点击颜色 ===
  console.log('==> Test 4: slide 颜色 hover+click')
  await page.locator('[data-testid="tab-slide"]').click()
  await page.waitForTimeout(500)
  await page.locator('[data-testid="ribbon-tab-home"]').click()
  await page.waitForTimeout(300)
  const slColorBtn = page.locator('button[title*="Color"]').first()
  if (await slColorBtn.count()) {
    await slColorBtn.hover()
    await page.waitForTimeout(400)
    const firstColor = page.locator('.ribbon-popup button').first()
    if (await firstColor.count()) {
      await firstColor.click()
      await page.waitForTimeout(500)
      const popups4 = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('.ribbon-popup')).filter(p => {
          const r = p.getBoundingClientRect()
          return r.width > 0 && r.height > 0
        }).length
      })
      if (popups4 > 0) {
        findings.push({ test: 'slide-color-click-stays', severity: 'fail', message: `演示颜色 popup 点击后仍打开 (${popups4} 个)` })
        await page.screenshot({ path: join(SHOTS, 'slide-color-stays.png') })
      } else {
        findings.push({ test: 'slide-color-click-stays', severity: 'pass', message: '演示颜色 popup 点击后关闭' })
      }
    }
  }

  // === 测试 5: 表格 ribbon 0 宽度元素定位 ===
  console.log('==> Test 5: spreadsheet ribbon 0 宽度元素定位')
  await page.locator('[data-testid="tab-spreadsheet"]').click()
  await page.waitForTimeout(500)
  const zeroWidths = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('.ribbon-scroll *'))
    return all.map((el, i) => {
      const r = el.getBoundingClientRect()
      if (r.width < 10 && r.height < 10) {
        return {
          i,
          tag: el.tagName,
          cls: el.className?.toString?.() || '',
          txt: (el.textContent || '').trim().slice(0, 30),
          w: Math.round(r.width), h: Math.round(r.height),
          parent: el.parentElement?.tagName + '.' + (el.parentElement?.className?.toString?.() || '').slice(0, 50),
        }
      }
      return null
    }).filter(Boolean)
  })
  if (zeroWidths.length > 0) {
    findings.push({ test: 'sheet-zero-width', severity: 'warn', message: `表格 ribbon 内 ${zeroWidths.length} 个 0 宽度元素`, items: zeroWidths.slice(0, 10) })
    console.log(`  发现 ${zeroWidths.length} 个 0 宽度元素，前 10 个:`)
    zeroWidths.slice(0, 10).forEach(z => console.log(`    ${z.tag}.${z.cls} parent=${z.parent} txt="${z.txt}" ${z.w}x${z.h}`))
  }

  // === 测试 6: 切换 ribbon tab 后 popup 是否残留 ===
  console.log('==> Test 6: 切换 ribbon tab 后 popup 残留')
  await page.locator('[data-testid="tab-document"]').click()
  await page.waitForTimeout(400)
  await page.locator('[data-testid="ribbon-tab-home"]').click()
  await page.waitForTimeout(300)
  await page.locator('button[title*="Color"]').first().hover()
  await page.waitForTimeout(400)
  // 切到 insert tab
  await page.locator('[data-testid="ribbon-tab-insert"]').click()
  await page.waitForTimeout(500)
  const popups6 = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.ribbon-popup')).filter(p => {
      const r = p.getBoundingClientRect()
      return r.width > 0 && r.height > 0
    }).length
  })
  if (popups6 > 0) {
    findings.push({ test: 'tab-switch-residual', severity: 'fail', message: `切换 ribbon tab 后 ${popups6} 个 popup 残留` })
    await page.screenshot({ path: join(SHOTS, 'tab-switch-residual.png') })
  } else {
    findings.push({ test: 'tab-switch-residual', severity: 'pass', message: '切换 ribbon tab 后无 popup 残留' })
  }

  await browser.close()

  console.log('\n========== 重现测试汇总 ==========')
  findings.forEach(f => {
    const icon = f.severity === 'pass' ? '✓' : f.severity === 'fail' ? '✗' : '!'
    console.log(`  ${icon} [${f.test}] ${f.message}`)
  })
  const fails = findings.filter(f => f.severity === 'fail').length
  console.log(`\n失败: ${fails}/${findings.length}`)
  process.exit(fails > 0 ? 1 : 0)
})().catch(e => { console.error('FATAL:', e); process.exit(2) })
