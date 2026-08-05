// fast-ui-audit.mjs
// 快速 UI 审计：截取每个 Tab + Ribbon 状态，检测菜单越界和重叠
import { firefox } from 'playwright'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

const BASE = 'http://localhost:18400'
const SHOTS = '/home/z/my-project/samoffice/scripts/e2e/fast-shots'
mkdirSync(SHOTS, { recursive: true })

const VIEWPORT = { width: 1280, height: 800 }
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

// 获取所有可见 popup
async function getVisiblePopups(page) {
  return await page.evaluate(() => {
    const sels = '.ribbon-popup, .files-dropdown, [class*="popup"], [class*="dropdown"], [class*="menu"], [role="menu"], [role="listbox"]'
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
        position: cs.position,
        classList: (p.className?.toString?.() || '').slice(0, 120),
        textContent: (p.textContent || '').trim().slice(0, 60),
      }
    }).filter(p => p.visible)
  })
}

function rectsOverlap(a, b) {
  return !(a.right <= b.x || b.right <= a.x || a.bottom <= b.y || b.bottom <= a.y)
}

// 检测 popup 越界
function checkOutOfBounds(popups, vw, vh) {
  for (const p of popups) {
    if (p.x < 0 || p.y < 0 || p.right > vw || p.bottom > vh) {
      record('layout', 'fail', `Popup 越界 viewport: [${p.x},${p.y},${p.right},${p.bottom}] viewport=[${vw}x${vh}] class="${p.classList}" text="${p.textContent}"`)
    }
  }
}

// 检测 popup 互相重叠
function checkOverlap(popups) {
  for (let i = 0; i < popups.length; i++) {
    for (let j = i + 1; j < popups.length; j++) {
      if (rectsOverlap(popups[i], popups[j])) {
        record('layout', 'fail', `Popup 重叠: #${i} [${popups[i].x},${popups[i].y},${popups[i].right},${popups[i].bottom}] vs #${j} [${popups[j].x},${popups[j].y},${popups[j].right},${popups[j].bottom}]`)
      }
    }
  }
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
  const ctx = await browser.newContext({ viewport: VIEWPORT, ignoreHTTPSErrors: true })
  const page = await ctx.newPage()

  page.on('console', m => {
    if (m.type() === 'error') record('console', 'error', `console.error: ${m.text().slice(0, 150)}`)
  })
  page.on('pageerror', e => record('console', 'error', `pageerror: ${e.message.slice(0, 150)}`))

  console.log('==> 1. 打开首页')
  await safe(async () => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 15000 })
    await page.waitForTimeout(800)
    await page.screenshot({ path: join(SHOTS, '00-home.png') })
    const title = await page.title()
    if (title.includes('SamOffice') || title.includes('SamOffice')) {
      record('shell', 'pass', `首页加载成功，title="${title}"`)
    } else {
      record('shell', 'fail', `首页 title 异常: "${title}"`)
    }
  }, 'home')

  // 遍历每个 Tab
  for (const tab of TABS) {
    console.log(`==> Tab: ${tab.name}`)
    await safe(async () => {
      await page.locator(`[data-testid="${tab.id}"]`).click({ timeout: 3000 })
      await page.waitForTimeout(400)
      await page.screenshot({ path: join(SHOTS, `tab-${tab.name}.png`) })
    }, `tab-${tab.name}`)

    // 收集所有 ribbon tab
    const ribbonTabs = await safe(async () => {
      return await page.evaluate(() => {
        return Array.from(document.querySelectorAll('[data-testid^="ribbon-tab-"]')).map(b => ({
          id: b.getAttribute('data-testid'),
          label: (b.textContent || '').trim(),
        }))
      })
    }, `ribbon-tabs-${tab.name}`) || []

    console.log(`  ${tab.name} 有 ${ribbonTabs.length} 个 ribbon tab`)

    for (const rt of ribbonTabs) {
      console.log(`  -> ribbon: ${rt.id} (${rt.label})`)
      await safe(async () => {
        await page.locator(`[data-testid="${rt.id}"]`).click({ timeout: 3000 })
        await page.waitForTimeout(300)
        await page.screenshot({ path: join(SHOTS, `${tab.name}-${rt.id}.png`) })

        // 收集所有可见按钮
        const buttons = await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('.ribbon-scroll button, .toolbar button, [class*="ribbon"] button, [class*="toolbar"] button'))
          return btns.map((b, i) => {
            const r = b.getBoundingClientRect()
            const cs = getComputedStyle(b)
            const visible = r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden'
            return {
              i, visible,
              x: Math.round(r.x), y: Math.round(r.y),
              w: Math.round(r.width), h: Math.round(r.height),
              text: (b.textContent || '').trim().slice(0, 30),
              title: b.getAttribute('title') || '',
              testid: b.getAttribute('data-testid') || '',
              cls: (b.className?.toString?.() || '').slice(0, 80),
            }
          }).filter(b => b.visible && b.w > 5)
        })

        // 对每个按钮 hover 一下，看是否弹出 popup
        for (const btn of buttons.slice(0, 30)) { // 限制前 30 个
          await safe(async () => {
            // 关闭所有 popup
            await page.mouse.click(640, 400)
            await page.waitForTimeout(100)
            // hover 按钮
            await page.mouse.move(btn.x + btn.w / 2, btn.y + btn.h / 2)
            await page.waitForTimeout(300)
            const popups = await getVisiblePopups(page)
            if (popups.length > 0) {
              checkOutOfBounds(popups, VIEWPORT.width, VIEWPORT.height)
              checkOverlap(popups)
              // 截图关键 popup
              if (popups.length >= 1) {
                await page.screenshot({ path: join(SHOTS, `${tab.name}-${rt.id}-btn${btn.i}-${(btn.title || btn.text).replace(/[^a-zA-Z0-9]/g, '').slice(0, 20)}.png`) })
              }
            }
          }, `hover-${tab.name}-${rt.id}-btn${btn.i}`)
        }
      }, `ribbon-${tab.name}-${rt.id}`)
    }
  }

  // === 移动端测试 ===
  console.log('==> 移动端测试')
  await safe(async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 15000 })
    await page.waitForTimeout(800)
    await page.screenshot({ path: join(SHOTS, 'mobile-home.png') })
    // 测试汉堡菜单
    const hamburger = page.locator('[data-testid="mobile-menu"], button[aria-label*="menu" i], .hamburger, [class*="burger"]')
    if (await hamburger.count() > 0) {
      await hamburger.first().click({ timeout: 3000 }).catch(() => {})
      await page.waitForTimeout(400)
      await page.screenshot({ path: join(SHOTS, 'mobile-menu-open.png') })
      const popups = await getVisiblePopups(page)
      checkOutOfBounds(popups, 390, 844)
      checkOverlap(popups)
    }
  }, 'mobile')

  // === 输出报告 ===
  console.log('\n=== 测试报告 ===')
  console.log(`Total checks: ${totalChecks}`)
  console.log(`Failures: ${failCount}`)
  console.log(`Pass rate: ${((totalChecks - failCount) / totalChecks * 100).toFixed(1)}%`)

  const report = {
    total: totalChecks,
    failures: failCount,
    passRate: ((totalChecks - failCount) / totalChecks * 100).toFixed(1) + '%',
    findings: findings.filter(f => f.severity === 'fail' || f.severity === 'error'),
    allFindings: findings,
  }
  writeFileSync('/home/z/my-project/samoffice/scripts/e2e/fast-audit-report.json', JSON.stringify(report, null, 2))

  console.log('\n=== 关键问题 ===')
  for (const f of report.findings.slice(0, 30)) {
    console.log(`[${f.category}] ${f.message}`)
  }

  await browser.close()
})().catch(e => {
  console.error('FATAL:', e)
  process.exit(1)
})
