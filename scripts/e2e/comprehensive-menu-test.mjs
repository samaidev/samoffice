// comprehensive-menu-test.mjs
// 综合菜单测试：对每个编辑器的每个 ribbon tab，遍历所有按钮，
// 检测：1) popup 越界  2) popup 互相重叠  3) popup 与触发按钮位置不合理
// 同时收集所有截图供 VLM 进一步分析

import { firefox } from 'playwright'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

const BASE = 'http://127.0.0.1:18400'
const SHOTS = '/home/z/my-project/samoffice/scripts/e2e/pw-shots-comprehensive'
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
    record('exception', 'error', `${label}: ${e.message}`)
    return null
  }
}

async function getVisiblePopups(page) {
  return await page.evaluate(() => {
    const sels = '.ribbon-popup, .files-dropdown, [class*="popup"], [class*="dropdown"], [class*="menu"]'
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
        classList: (p.className?.toString?.() || '').slice(0, 100),
        textContent: (p.textContent || '').trim().slice(0, 50),
      }
    }).filter(p => p.visible)
  })
}

function rectsOverlap(a, b) {
  return !(a.right <= b.x || b.right <= a.x || a.bottom <= b.y || b.bottom <= a.y)
}

// 收集所有 ribbon tab
async function getRibbonTabs(page) {
  return await page.evaluate(() => {
    return Array.from(document.querySelectorAll('[data-testid^="ribbon-tab-"]')).map(b => ({
      id: b.getAttribute('data-testid'),
      label: (b.textContent || '').trim(),
    }))
  })
}

// 收集当前 ribbon 内所有按钮
async function getRibbonButtons(page) {
  return await page.evaluate(() => {
    // 所有 ribbon 区域的可点击按钮
    const btns = Array.from(document.querySelectorAll('.ribbon-scroll button, .toolbar button, [class*="ribbon"] button'))
    return btns.map((b, i) => {
      const r = b.getBoundingClientRect()
      const cs = getComputedStyle(b)
      const visible = r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden'
      return {
        i,
        visible,
        x: Math.round(r.x), y: Math.round(r.y),
        w: Math.round(r.width), h: Math.round(r.height),
        text: (b.textContent || '').trim().slice(0, 30),
        title: b.getAttribute('title') || '',
        testid: b.getAttribute('data-testid') || '',
        cls: (b.className?.toString?.() || '').slice(0, 60),
      }
    }).filter(b => b.visible && b.w > 5)
  })
}

// === 测试主流程 ===
;(async () => {
  const browser = await firefox.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  const ctx = await browser.newContext({ viewport: VIEWPORT, ignoreHTTPSErrors: true })
  const page = await ctx.newPage()

  page.on('console', m => {
    if (m.type() === 'error') record('console', 'error', `console.error: ${m.text()}`)
  })
  page.on('pageerror', e => record('console', 'error', `pageerror: ${e.message}`))

  console.log('==> 1. 打开首页')
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(800)
  await page.screenshot({ path: join(SHOTS, '00-home.png') })

  // 测试各编辑器 × 各 ribbon tab × 各按钮
  const editors = ['document', 'spreadsheet', 'slide', 'markdown', 'html']
  for (const ed of editors) {
    console.log(`\n==> 编辑器: ${ed}`)
    await safe(async () => {
      // 先按 ESC 退出可能残留的放映模式
      await page.keyboard.press('Escape').catch(() => {})
      await page.waitForTimeout(100)
      await page.locator(`[data-testid="tab-${ed}"]`).click()
      await page.waitForTimeout(500)
      await page.screenshot({ path: join(SHOTS, `${ed}-default.png`) })

      const ribbonTabs = await getRibbonTabs(page)
      console.log(`  ribbon tabs: ${ribbonTabs.map(t => t.id).join(', ')}`)

      for (const rt of ribbonTabs) {
        console.log(`  -> ribbon tab: ${rt.id}`)
        await safe(async () => {
          // 先按 ESC 退出可能残留的放映模式/popup
          await page.keyboard.press('Escape').catch(() => {})
          await page.waitForTimeout(100)
          await page.locator(`[data-testid="${rt.id}"]`).click()
          await page.waitForTimeout(300)

          // 收集按钮
          const btns = await getRibbonButtons(page)
          console.log(`     ${btns.length} 个按钮`)

          // 截图 ribbon tab 初始状态
          const tabName = rt.id.replace('ribbon-tab-', '')
          await page.screenshot({ path: join(SHOTS, `${ed}-${tabName}-initial.png`) })

          // 检查 ribbon 内是否有按钮被挤压（width < 10）
          const squeezed = btns.filter(b => b.w < 10)
          if (squeezed.length > 0) {
            record('layout-squeeze', 'fail', `${ed}/${tabName}: ${squeezed.length} 个按钮宽度 < 10px`, squeezed.slice(0, 5))
          }

          // 检查按钮间是否重叠
          for (let i = 0; i < btns.length; i++) {
            for (let j = i + 1; j < btns.length; j++) {
              // 只有同行/同列的按钮才需要比较；这里只比较显著重叠
              const a = btns[i], b = btns[j]
              const overlapX = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
              const overlapY = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
              const overlapArea = overlapX * overlapY
              const minArea = Math.min(a.w * a.h, b.w * b.h)
              if (overlapArea > 0 && overlapArea / minArea > 0.3) {
                record('button-overlap', 'fail', `${ed}/${tabName}: 按钮 "${a.text||a.title}" 与 "${b.text||b.title}" 重叠 ${Math.round(overlapArea/minArea*100)}%`, { a, b })
              }
            }
          }

          // 对每个有 popup 行为的按钮进行点击测试
          // 候选：title 含 Color/颜色/Highlight/高亮/Shading/底纹/Background/背景/Font/字体/Size/字号
          // 或 text 含 Shape/形状/Art/艺术字/Table/表格/Symbol/符号
          // 排除：放映按钮（From Start/From Current/Play）— 会触发全屏放映
          const popupTriggers = btns.filter(b => {
            const t = (b.title + ' ' + b.text).toLowerCase()
            // 排除放映/播放按钮
            if (/from start|from current|play|present|slideshow|放映|播放/i.test(t)) return false
            return /color|颜色|highlight|高亮|shading|底纹|background|背景|shape|形状|art|艺术字|symbol|符号|font|字体|size|字号/i.test(t)
          })
          console.log(`     ${popupTriggers.length} 个 popup 触发候选`)

          for (const btn of popupTriggers) {
            await safe(async () => {
              // 关闭所有 popup — 用 ESC 而非点击空白处（避免误触发 slide 放映）
              await page.keyboard.press('Escape').catch(() => {})
              await page.waitForTimeout(150)

              // 通过 text/title 定位
              let loc
              if (btn.testid) loc = page.locator(`[data-testid="${btn.testid}"]`).first()
              else if (btn.title) loc = page.locator(`button[title="${btn.title}"]`).first()
              else loc = page.locator(`button:has-text("${btn.text}")`).first()

              if (!(await loc.count())) {
                record('popup-trigger', 'warn', `${ed}/${tabName} ${btn.text||btn.title}: 无法定位按钮`)
                return
              }

              await loc.click()
              await page.waitForTimeout(400)

              const popups = await getVisiblePopups(page)
              if (popups.length === 0) {
                // 该按钮可能不触发 popup，跳过
                return
              }

              // 截图
              const btnLabel = (btn.text || btn.title || 'btn').replace(/[^\w\u4e00-\u9fa5]/g, '_').slice(0, 20)
              const shotName = `${ed}-${tabName}-${btnLabel}.png`
              await page.screenshot({ path: join(SHOTS, shotName) })

              // 检查 popup 越界
              const vp = VIEWPORT
              for (const p of popups) {
                if (p.x < 0 || p.y < 0 || p.right > vp.width || p.bottom > vp.height) {
                  record('popup-overflow', 'fail', `${ed}/${tabName} ${btnLabel}: popup 越界 x=${p.x} y=${p.y} right=${p.right} bottom=${p.bottom}`, p)
                }
              }

              // 检查 popup 互相重叠
              for (let i = 0; i < popups.length; i++) {
                for (let j = i + 1; j < popups.length; j++) {
                  if (rectsOverlap(popups[i], popups[j])) {
                    record('popup-overlap', 'fail', `${ed}/${tabName} ${btnLabel}: popup 互相重叠`, { a: popups[i], b: popups[j] })
                  }
                }
              }

              // 点击外部应关闭 — 用 ESC
              await page.keyboard.press('Escape').catch(() => {})
              await page.waitForTimeout(300)
              const after = await getVisiblePopups(page)
              if (after.length > 0) {
                record('popup-close', 'fail', `${ed}/${tabName} ${btnLabel}: 点击外部后 ${after.length} 个 popup 未关闭`, after)
              }
            }, `按钮 ${btn.text||btn.title}`)
          }
        }, `ribbon tab ${rt.id}`)
      }
    }, `编辑器 ${ed}`)
  }

  // === 移动端测试 ===
  console.log('\n==> 移动端测试 (iPhone 13)')
  await safe(async () => {
    await page.keyboard.press('Escape').catch(() => {})
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(500)
    await page.locator('[data-testid="tab-document"]').click().catch(() => {})
    await page.waitForTimeout(300)
    await page.screenshot({ path: join(SHOTS, 'mobile-document.png') })

    // 移动端汉堡菜单
    const hamburger = page.locator('[data-testid="hamburger-toggle"]')
    if (await hamburger.count()) {
      await hamburger.click()
      await page.waitForTimeout(400)
      await page.screenshot({ path: join(SHOTS, 'mobile-hamburger-open.png') })
      const popups = await getVisiblePopups(page)
      for (const p of popups) {
        if (p.x < 0 || p.right > 390 || p.y < 0 || p.bottom > 844) {
          record('mobile-popup-overflow', 'fail', `移动端汉堡菜单越界: x=${p.x} right=${p.right} (vp 390)`, p)
        }
      }
    }
    await page.setViewportSize(VIEWPORT)
  }, '移动端测试')

  // === 窄屏桌面（800x600）测试 ribbon wrap ===
  console.log('\n==> 窄屏测试 (900x600)')
  await safe(async () => {
    await page.keyboard.press('Escape').catch(() => {})
    await page.setViewportSize({ width: 900, height: 600 })
    await page.waitForTimeout(500)
    for (const ed of ['document', 'spreadsheet', 'slide']) {
      await page.locator(`[data-testid="tab-${ed}"]`).click()
      await page.waitForTimeout(400)
      const tabs = await getRibbonTabs(page)
      for (const rt of tabs.slice(0, 3)) {
        await page.locator(`[data-testid="${rt.id}"]`).click()
        await page.waitForTimeout(300)
        const btns = await getRibbonButtons(page)
        const squeezed = btns.filter(b => b.w < 10)
        if (squeezed.length > 0) {
          record('narrow-squeeze', 'fail', `窄屏 ${ed}/${rt.id}: ${squeezed.length} 个按钮宽度 < 10px`, squeezed.slice(0, 3))
        }
        // 按钮重叠
        for (let i = 0; i < btns.length; i++) {
          for (let j = i + 1; j < btns.length; j++) {
            const a = btns[i], b = btns[j]
            const overlapX = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
            const overlapY = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
            const overlapArea = overlapX * overlapY
            const minArea = Math.min(a.w * a.h, b.w * b.h)
            if (overlapArea > 0 && overlapArea / minArea > 0.3) {
              record('narrow-button-overlap', 'fail', `窄屏 ${ed}/${rt.id}: "${a.text||a.title}" 与 "${b.text||b.title}" 重叠 ${Math.round(overlapArea/minArea*100)}%`, { a, b })
            }
          }
        }
        await page.screenshot({ path: join(SHOTS, `narrow-${ed}-${rt.id}.png`) })
      }
    }
    await page.setViewportSize(VIEWPORT)
  }, '窄屏测试')

  await browser.close()

  // 汇总
  const passCount = totalChecks - failCount
  const summary = {
    total: totalChecks,
    pass: passCount,
    fail: failCount,
    passRate: totalChecks > 0 ? `${((passCount / totalChecks) * 100).toFixed(1)}%` : '0%',
  }
  console.log('\n========== 综合测试汇总 ==========')
  console.log(JSON.stringify(summary, null, 2))
  console.log('\n失败项明细:')
  findings.filter(f => f.severity === 'fail' || f.severity === 'error').forEach((f, i) => {
    console.log(`  [${i + 1}] [${f.category}] ${f.message}`)
  })

  writeFileSync('/home/z/my-project/samoffice/scripts/e2e/comprehensive-results.json', JSON.stringify({ summary, findings }, null, 2))
  process.exit(failCount > 0 ? 1 : 0)
})().catch(e => { console.error('FATAL:', e); process.exit(2) })
