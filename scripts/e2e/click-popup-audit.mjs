// click-popup-audit.mjs
// 通过 click 触发 popup（颜色/高亮/形状/艺术字/背景等），检测越界和重叠
import { firefox } from 'playwright'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

const BASE = 'http://localhost:18400'
const SHOTS = '/home/z/my-project/samoffice/scripts/e2e/click-shots'
mkdirSync(SHOTS, { recursive: true })

const VW = 1280, VH = 800
const findings = []
let totalChecks = 0, failCount = 0

function record(category, severity, message, context = {}) {
  totalChecks++
  if (severity === 'fail' || severity === 'error') failCount++
  findings.push({ category, severity, message, context, ts: new Date().toISOString() })
}

async function safe(fn, label) {
  try { return await fn() } catch (e) {
    record('exception', 'error', `${label}: ${e.message.slice(0, 200)}`)
    return null
  }
}

async function getVisiblePopups(page) {
  return await page.evaluate(() => {
    const sels = '.ribbon-popup, .files-dropdown, [class*="popup"], [class*="dropdown"], [role="menu"], [role="listbox"]'
    const all = Array.from(document.querySelectorAll(sels))
    return all.map((p, i) => {
      const r = p.getBoundingClientRect()
      const cs = getComputedStyle(p)
      const visible = r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.05
      return {
        i, visible,
        x: Math.round(r.x), y: Math.round(r.y),
        w: Math.round(r.width), h: Math.round(r.height),
        right: Math.round(r.right), bottom: Math.round(r.bottom),
        zIndex: cs.zIndex,
        cls: (p.className?.toString?.() || '').slice(0, 120),
        text: (p.textContent || '').trim().slice(0, 60),
      }
    }).filter(p => p.visible)
  })
}

function rectsOverlap(a, b) {
  return !(a.right <= b.x || b.right <= a.x || a.bottom <= b.y || b.bottom <= a.y)
}

function checkPopups(popups, label, page) {
  for (const p of popups) {
    if (p.x < 0 || p.y < 0 || p.right > VW || p.bottom > VH) {
      record('layout', 'fail', `[${label}] Popup 越界 viewport: popup[${p.x},${p.y},${p.right},${p.bottom}] cls="${p.cls}" text="${p.text}"`)
    }
  }
  for (let i = 0; i < popups.length; i++) {
    for (let j = i + 1; j < popups.length; j++) {
      if (rectsOverlap(popups[i], popups[j])) {
        record('layout', 'fail', `[${label}] Popup 重叠: #${i} [${popups[i].x},${popups[i].y},${popups[i].right},${popups[i].bottom}] ↔ #${j} [${popups[j].x},${popups[j].y},${popups[j].right},${popups[j].bottom}]`)
      }
    }
  }
}

// 点击按钮并检查 popup
async function clickAndCheck(page, btnSelector, label, shotName) {
  return safe(async () => {
    const btn = page.locator(btnSelector).first()
    if (!(await btn.count())) {
      record('test', 'warn', `[${label}] 按钮未找到: ${btnSelector}`)
      return
    }
    // 关闭所有 popup
    await page.mouse.click(10, 10)
    await page.waitForTimeout(100)
    await btn.click({ timeout: 3000 })
    await page.waitForTimeout(300)
    const popups = await getVisiblePopups(page)
    if (popups.length === 0) {
      record('test', 'pass', `[${label}] 无 popup（可能不是 popup 按钮）`)
      return
    }
    checkPopups(popups, label, page)
    await page.screenshot({ path: join(SHOTS, `${shotName}.png`) })
    record('test', 'pass', `[${label}] popup 数=${popups.length}`)
  }, `click-${label}`)
}

const TABS = [
  { id: 'tab-document', name: 'document' },
  { id: 'tab-spreadsheet', name: 'spreadsheet' },
  { id: 'tab-slide', name: 'slide' },
  { id: 'tab-markdown', name: 'markdown' },
  { id: 'tab-html', name: 'html' },
]

;(async () => {
  const browser = await firefox.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH } })
  const page = await ctx.newPage()

  page.on('console', m => {
    if (m.type() === 'error') record('console', 'error', `console.error: ${m.text().slice(0, 150)}`)
  })
  page.on('pageerror', e => record('console', 'error', `pageerror: ${e.message.slice(0, 150)}`))

  console.log('==> 首页')
  await safe(async () => {
    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 20000 })
    await page.waitForTimeout(1500)
  }, 'home')

  // === 测试 Files 下拉菜单 ===
  console.log('==> Files 下拉菜单')
  await safe(async () => {
    await page.locator('[data-testid="menu-files"]').click({ timeout: 3000 })
    await page.waitForTimeout(300)
    const popups = await getVisiblePopups(page)
    checkPopups(popups, 'files-menu', page)
    await page.screenshot({ path: join(SHOTS, 'files-menu.png') })
    record('test', 'pass', `[files-menu] popup 数=${popups.length}`)
  }, 'files-menu')

  // 关闭 Files 菜单
  await page.mouse.click(10, 10)
  await page.waitForTimeout(200)

  // === 遍历每个编辑器 ===
  for (const tab of TABS) {
    console.log(`==> Tab: ${tab.name}`)
    await safe(async () => {
      await page.locator(`[data-testid="${tab.id}"]`).click({ timeout: 5000 })
      await page.waitForTimeout(600)
    }, `tab-${tab.name}`)

    // 收集所有 ribbon tabs
    const ribbonTabs = await safe(async () => {
      return await page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-testid^="ribbon-tab-"]')).map(b => ({
          id: b.getAttribute('data-testid'),
          label: (b.textContent || '').trim()
        }))
      )
    }, `ribbon-tabs-${tab.name}`) || []

    for (const rt of ribbonTabs) {
      console.log(`  -> ${rt.id}`)
      await safe(async () => {
        await page.locator(`[data-testid="${rt.id}"]`).click({ timeout: 3000 })
        await page.waitForTimeout(300)
      }, `click-${rt.id}`)

      // 找出所有可能触发 popup 的按钮（有 title 含 Color/Highlight/Shape/Art/Background/Shading/Font/Fill 等关键字）
      const popupTriggers = await safe(async () => {
        return await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('.ribbon-scroll button, .toolbar button, [class*="ribbon"] button'))
          const keywords = ['color', 'highlight', 'shape', 'art', 'background', 'shading', 'fill', 'theme', 'font', 'style', 'image', 'table', 'chart', 'symbol']
          return btns.map((b, i) => {
            const r = b.getBoundingClientRect()
            const cs = getComputedStyle(b)
            const visible = r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden'
            const title = (b.getAttribute('title') || '').toLowerCase()
            const text = (b.textContent || '').toLowerCase().trim()
            const hasPopupKeyword = keywords.some(k => title.includes(k) || text.includes(k))
            // 检查 button 是否在 .relative 容器内（即可能弹 popup）
            const parent = b.parentElement
            const hasRelativeParent = parent?.classList.contains('relative') || parent?.closest('.relative')
            return {
              i, visible,
              cx: Math.round(r.x + r.width / 2),
              cy: Math.round(r.y + r.height / 2),
              w: Math.round(r.width), h: Math.round(r.height),
              title: b.getAttribute('title') || '',
              text: (b.textContent || '').trim().slice(0, 20),
              hasPopupKeyword,
              hasRelativeParent: !!hasRelativeParent,
            }
          }).filter(b => b.visible && b.w > 5 && (b.hasPopupKeyword || b.hasRelativeParent))
        })
      }, `triggers-${tab.name}-${rt.id}`) || []

      console.log(`    ${popupTriggers.length} 个潜在 popup 按钮`)

      // 点击每个潜在 popup 按钮
      for (const btn of popupTriggers.slice(0, 20)) {
        const label = `${tab.name}-${rt.id}-btn${btn.i}-${(btn.title || btn.text).replace(/[^a-zA-Z0-9]/g, '').slice(0, 15)}`
        await safe(async () => {
          // 关闭所有 popup
          await page.mouse.click(10, 10)
          await page.waitForTimeout(80)
          // 点击按钮
          await page.mouse.click(btn.cx, btn.cy)
          await page.waitForTimeout(250)
          const popups = await getVisiblePopups(page)
          if (popups.length > 0) {
            checkPopups(popups, label, page)
            await page.screenshot({ path: join(SHOTS, `${label}.png`) })
            record('test', 'info', `[${label}] popup 数=${popups.length}`)
          }
        }, `click-${label}`)
      }
    }
  }

  // === 移动端测试 ===
  console.log('==> 移动端测试')
  await safe(async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 15000 })
    await page.waitForTimeout(1000)
    await page.screenshot({ path: join(SHOTS, 'mobile-home.png') })

    // 测试汉堡菜单
    const hamburger = page.locator('[data-testid="hamburger-toggle"]')
    if (await hamburger.count()) {
      await hamburger.click({ timeout: 3000 })
      await page.waitForTimeout(400)
      await page.screenshot({ path: join(SHOTS, 'mobile-menu.png') })
      const popups = await getVisiblePopups(page)
      // 移动端用 390x844 viewport
      for (const p of popups) {
        if (p.x < 0 || p.y < 0 || p.right > 390 || p.bottom > 844) {
          record('layout', 'fail', `[mobile-menu] Popup 越界 viewport: popup[${p.x},${p.y},${p.right},${p.bottom}]`)
        }
      }
    }

    // 移动端 document tab 测试
    await page.locator('[data-testid="tab-document"]').click({ timeout: 3000 }).catch(() => {})
    await page.waitForTimeout(500)
    await page.screenshot({ path: join(SHOTS, 'mobile-document.png') })
  }, 'mobile')

  // === 输出报告 ===
  console.log('\n=== 测试报告 ===')
  console.log(`Total checks: ${totalChecks}`)
  console.log(`Failures: ${failCount}`)
  console.log(`Pass rate: ${((totalChecks - failCount) / Math.max(totalChecks, 1) * 100).toFixed(1)}%`)

  const report = {
    total: totalChecks,
    failures: failCount,
    passRate: ((totalChecks - failCount) / Math.max(totalChecks, 1) * 100).toFixed(1) + '%',
    failFindings: findings.filter(f => f.severity === 'fail' || f.severity === 'error'),
    allFindings: findings,
  }
  writeFileSync('/home/z/my-project/samoffice/scripts/e2e/click-audit-report.json', JSON.stringify(report, null, 2))

  console.log('\n=== 关键问题 ===')
  for (const f of report.failFindings.slice(0, 40)) {
    console.log(`[${f.category}] ${f.message}`)
  }

  await browser.close()
  console.log('\n=== 完成 ===')
})().catch(e => { console.error('FATAL:', e); process.exit(1) })
