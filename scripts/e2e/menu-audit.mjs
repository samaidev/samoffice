// menu-audit.mjs
// 专门审计二级弹出菜单：重叠 / 越界 / 不统一 / 不关闭 / z-index 冲突
// 用法: node scripts/e2e/menu-audit.mjs

import { firefox } from 'playwright'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

const BASE = 'http://127.0.0.1:18400'
const SHOTS = '/home/z/my-project/samoffice/scripts/e2e/pw-shots-audit'
mkdirSync(SHOTS, { recursive: true })

const VIEWPORT = { width: 1280, height: 800 }

// 颜色按钮、形状按钮、艺术字按钮、底纹按钮、页面背景按钮 —— 这些都是二级弹出菜单
// 通过 group-hover 触发，是问题最集中的地方
const AUDIT_TARGETS = [
  {
    editor: 'document',
    ribbonTab: 'home',
    popups: [
      { desc: '文字颜色 A', trigger: 'button[title*="Color"]', popup: '.ribbon-popup', click: true },
      { desc: '高亮 H', trigger: 'button[title*="Highlight"]', popup: '.ribbon-popup', click: true },
    ],
  },
  {
    editor: 'document',
    ribbonTab: 'insert',
    popups: [
      { desc: '形状面板', trigger: 'button:has-text("Shape")', popup: '.ribbon-popup', click: true },
      { desc: '艺术字', trigger: 'button:has-text("Art")', popup: '.ribbon-popup', click: true },
    ],
  },
  {
    editor: 'document',
    ribbonTab: 'layout',
    popups: [
      { desc: '底纹', trigger: 'button[title*="Shading"]', popup: '.ribbon-popup', click: true },
    ],
  },
  {
    editor: 'document',
    ribbonTab: 'view',
    popups: [
      { desc: '页面背景', trigger: 'button[title*="Background"]', popup: '.ribbon-popup', click: true },
    ],
  },
  // 表格编辑器
  {
    editor: 'spreadsheet',
    ribbonTab: 'home',
    popups: [
      { desc: '字体色', trigger: 'button[title*="Color"]', popup: '.ribbon-popup', click: true },
    ],
  },
  // 演示编辑器
  {
    editor: 'slide',
    ribbonTab: 'home',
    popups: [
      { desc: '颜色', trigger: 'button[title*="Color"]', popup: '.ribbon-popup', click: true },
    ],
  },
  {
    editor: 'slide',
    ribbonTab: 'insert',
    popups: [
      { desc: '形状', trigger: 'button:has-text("Shape")', popup: '.ribbon-popup', click: true },
      { desc: '艺术字', trigger: 'button:has-text("Art")', popup: '.ribbon-popup', click: true },
    ],
  },
]

const findings = []
let totalChecks = 0
let failCount = 0

function record(category, severity, message, context = {}) {
  totalChecks++
  if (severity !== 'pass') failCount++
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
    const popups = Array.from(document.querySelectorAll('.ribbon-popup, .files-dropdown'))
    return popups.map((p, i) => {
      const r = p.getBoundingClientRect()
      const cs = getComputedStyle(p)
      return {
        i,
        visible: r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden',
        x: Math.round(r.x), y: Math.round(r.y),
        w: Math.round(r.width), h: Math.round(r.height),
        right: Math.round(r.right), bottom: Math.round(r.bottom),
        zIndex: cs.zIndex,
        classList: p.className,
      }
    }).filter(p => p.visible)
  })
}

function rectsOverlap(a, b) {
  return !(a.right <= b.x || b.right <= a.x || a.bottom <= b.y || b.bottom <= a.y)
}

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
  await page.screenshot({ path: join(SHOTS, '00-home.png'), fullPage: false })

  // 验证基础可用
  const title = await page.title()
  if (title.includes('GoOffice') || title.includes('SamOffice')) {
    record('shell', 'pass', `首页 title 正常: ${title}`)
  } else {
    record('shell', 'warn', `首页 title 异常: ${title}`)
  }

  console.log('==> 2. 顶栏 Files 下拉菜单审计')
  await safe(async () => {
    const btn = page.locator('[data-testid="menu-files"]').first()
    if (!(await btn.count())) { record('files-menu', 'warn', '未找到 Files 按钮（可能在移动端）'); return }
    await btn.click()
    await page.waitForTimeout(300)
    const popups = await getVisiblePopups(page)
    if (popups.length === 0) {
      record('files-menu', 'fail', '点击 Files 后无可见弹出菜单')
      return
    }
    // 越界检查
    const vp = VIEWPORT
    for (const p of popups) {
      if (p.x < 0 || p.y < 0 || p.right > vp.width || p.bottom > vp.height) {
        record('files-menu', 'fail', `Files 菜单越界: x=${p.x} y=${p.y} right=${p.right} bottom=${p.bottom}`, p)
      } else {
        record('files-menu', 'pass', `Files 菜单在视口内: x=${p.x} y=${p.y} w=${p.w} h=${p.h}`)
      }
    }
    await page.screenshot({ path: join(SHOTS, '01-files-menu.png') })
    // 点击外部应关闭
    await page.mouse.click(640, 400)
    await page.waitForTimeout(300)
    const after = await getVisiblePopups(page)
    if (after.length > 0) {
      record('files-menu', 'fail', '点击外部后 Files 菜单未关闭', after)
    } else {
      record('files-menu', 'pass', '点击外部后 Files 菜单正常关闭')
    }
  }, 'Files 菜单审计')

  console.log('==> 3. 各编辑器二级弹出菜单审计')
  for (const target of AUDIT_TARGETS) {
    console.log(`  -> ${target.editor}/${target.ribbonTab}`)
    await safe(async () => {
      // 切到对应 Tab
      const tabBtn = page.locator(`[data-testid="tab-${target.editor}"]`).first()
      if (!(await tabBtn.count())) { record('navigate', 'warn', `未找到 tab-${target.editor}`); return }
      await tabBtn.click()
      await page.waitForTimeout(500)

      // 切到 ribbon 子 tab
      const ribbonTabBtn = page.locator(`[data-testid="ribbon-tab-${target.ribbonTab}"]`).first()
      if (await ribbonTabBtn.count()) {
        await ribbonTabBtn.click()
        await page.waitForTimeout(300)
      }

      for (const item of target.popups) {
        const triggerBtn = page.locator(item.trigger).first()
        if (!(await triggerBtn.count())) {
          record('popup', 'warn', `${target.editor}/${target.ribbonTab} ${item.desc}: 未找到触发按钮 selector=${item.trigger}`)
          continue
        }
        // 先点空白处确保所有 popup 关闭
        await page.mouse.click(640, 400)
        await page.waitForTimeout(200)

        if (item.click) {
          await triggerBtn.click()
        } else {
          await triggerBtn.hover()
        }
        await page.waitForTimeout(400)

        const popups = await getVisiblePopups(page)
        if (popups.length === 0) {
          record('popup', 'fail', `${target.editor}/${target.ribbonTab} ${item.desc}: 触发后无可见 popup`)
          continue
        }
        if (popups.length > 1) {
          record('popup', 'fail', `${target.editor}/${target.ribbonTab} ${item.desc}: 同时出现 ${popups.length} 个 popup（应只有 1 个）`, popups)
        } else {
          record('popup', 'pass', `${target.editor}/${target.ribbonTab} ${item.desc}: 单 popup 显示`)
        }
        // 越界检查
        const vp = VIEWPORT
        for (const p of popups) {
          if (p.x < 0 || p.y < 0 || p.right > vp.width || p.bottom > vp.height) {
            record('popup-bound', 'fail', `${item.desc} 越界: x=${p.x} y=${p.y} right=${p.right} bottom=${p.bottom} (vp ${vp.width}x${vp.height})`, p)
          }
        }
        // 截图
        const shotName = `${target.editor}-${target.ribbonTab}-${item.desc}.png`.replace(/\s+/g, '_')
        await page.screenshot({ path: join(SHOTS, shotName) })

        // 点击外部应关闭
        await page.mouse.click(640, 400)
        await page.waitForTimeout(300)
        const after = await getVisiblePopups(page)
        if (after.length > 0) {
          record('popup-close', 'fail', `${item.desc}: 点击外部后未关闭 (剩 ${after.length} 个)`, after)
        } else {
          record('popup-close', 'pass', `${item.desc}: 点击外部后正常关闭`)
        }
      }
    }, `${target.editor}/${target.ribbonTab} 审计`)
  }

  console.log('==> 4. 连续 hover 多个按钮 — 检测残留 popup（重叠根因）')
  await safe(async () => {
    await page.locator('[data-testid="tab-document"]').click()
    await page.waitForTimeout(300)
    await page.locator('[data-testid="ribbon-tab-home"]').click()
    await page.waitForTimeout(300)

    // 连续 hover 颜色按钮、高亮按钮、加粗按钮等
    const candidates = [
      'button[title*="颜色"]',
      'button[title*="高亮"]',
      'button:has-text("B")',
      'button:has-text("I")',
    ]
    for (const sel of candidates) {
      const btn = page.locator(sel).first()
      if (await btn.count()) {
        await btn.hover()
        await page.waitForTimeout(250)
      }
    }
    await page.waitForTimeout(400)
    const popups = await getVisiblePopups(page)
    if (popups.length > 1) {
      record('overlap', 'fail', `连续 hover 后仍有 ${popups.length} 个 popup 同时可见（重叠）`, popups)
      await page.screenshot({ path: join(SHOTS, 'overlap-after-hover.png') })
    } else if (popups.length === 1) {
      // 单个 popup 是否合理取决于鼠标当前位置；这里仅记录
      record('overlap', 'warn', `连续 hover 后剩 1 个 popup`, popups[0])
    } else {
      record('overlap', 'pass', '连续 hover 后无残留 popup')
    }
  }, '连续 hover 检测')

  console.log('==> 5. 表格编辑器 ribbon 横向布局检查')
  await safe(async () => {
    await page.locator('[data-testid="tab-spreadsheet"]').click()
    await page.waitForTimeout(500)
    // 检查 ribbon 内容区是否出现按钮被挤压到 0 宽度
    const squeezed = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('.ribbon-scroll button, .ribbon-scroll .ribbon-group'))
      return btns.map(b => {
        const r = b.getBoundingClientRect()
        return { txt: (b.textContent || '').trim().slice(0, 20), w: Math.round(r.width), h: Math.round(r.height) }
      }).filter(b => b.w < 10)
    })
    if (squeezed.length > 0) {
      record('layout', 'fail', `表格 ribbon 有 ${squeezed.length} 个元素被挤压到 <10px`, squeezed)
    } else {
      record('layout', 'pass', '表格 ribbon 无被挤压元素')
    }
    await page.screenshot({ path: join(SHOTS, 'spreadsheet-ribbon.png') })
  }, '表格 ribbon 检查')

  console.log('==> 6. 移动端视口下的菜单')
  await safe(async () => {
    await page.setViewportSize({ width: 390, height: 844 }) // iPhone 13
    await page.waitForTimeout(500)
    // 切到 document
    await page.locator('[data-testid="tab-document"]').click().catch(() => {})
    await page.waitForTimeout(300)
    await page.locator('[data-testid="ribbon-tab-home"]').click().catch(() => {})
    await page.waitForTimeout(300)
    // hover 颜色按钮
    const colorBtn = page.locator('button[title*="颜色"]').first()
    if (await colorBtn.count()) {
      await colorBtn.hover()
      await page.waitForTimeout(400)
      const popups = await getVisiblePopups(page)
      for (const p of popups) {
        if (p.x < 0 || p.right > 390 || p.y < 0 || p.bottom > 844) {
          record('mobile-popup', 'fail', `移动端 popup 越界: x=${p.x} right=${p.right} (vp 390)`, p)
        }
      }
      if (popups.length > 0) {
        record('mobile-popup', 'info', `移动端 popup ${popups.length} 个`, popups)
        await page.screenshot({ path: join(SHOTS, 'mobile-color-popup.png') })
      }
    }
    await page.setViewportSize(VIEWPORT)
  }, '移动端菜单检查')

  await browser.close()

  // 汇总
  const passCount = totalChecks - failCount
  const passRate = totalChecks > 0 ? ((passCount / totalChecks) * 100).toFixed(1) : '0'
  const summary = {
    total: totalChecks,
    pass: passCount,
    fail: failCount,
    passRate: `${passRate}%`,
  }
  console.log('\n========== 审计汇总 ==========')
  console.log(JSON.stringify(summary, null, 2))
  console.log('失败项明细:')
  findings.filter(f => f.severity === 'fail').forEach((f, i) => {
    console.log(`  [${i + 1}] [${f.category}] ${f.message}`)
  })

  writeFileSync('/home/z/my-project/samoffice/scripts/e2e/menu-audit-results.json', JSON.stringify({ summary, findings }, null, 2))
  process.exit(failCount > 0 ? 1 : 0)
})().catch(e => { console.error('FATAL:', e); process.exit(2) })
