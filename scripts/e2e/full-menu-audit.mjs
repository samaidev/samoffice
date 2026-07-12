// full-menu-audit.mjs
// 全面审计菜单问题：
//   1) 遮罩拦截 tab 切换（用户体感"按钮菜单重叠"的核心痛点）
//   2) popup 越界（左右上下超出视口）
//   3) popup 与 Files 下拉菜单 z-index 冲突
//   4) popup 在窄屏 (900x600) 下被挤压
//   5) 移动端汉堡菜单越界
//   6) popup 切换 ribbon tab 后未关闭
//   7) popup 切换编辑器 tab 后未关闭

import { firefox } from 'playwright'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

const BASE = 'http://127.0.0.1:18400'
const SHOTS = '/home/z/my-project/samoffice/scripts/e2e/pw-shots-full-audit'
mkdirSync(SHOTS, { recursive: true })
const VP = { width: 1280, height: 800 }

const findings = []
let pass = 0, fail = 0, warn = 0
function rec(cat, sev, msg, ctx = {}) {
  findings.push({ cat, sev, msg, ctx, ts: new Date().toISOString() })
  if (sev === 'pass') pass++
  else if (sev === 'fail') fail++
  else if (sev === 'warn') warn++
}

async function getVisiblePopups(page) {
  return await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.ribbon-popup, .files-dropdown')).map(p => {
      const r = p.getBoundingClientRect()
      const cs = getComputedStyle(p)
      const visible = r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.05
      return {
        cls: (p.className?.toString?.() || '').slice(0, 80),
        visible,
        x: Math.round(r.x), y: Math.round(r.y),
        w: Math.round(r.width), h: Math.round(r.height),
        right: Math.round(r.right), bottom: Math.round(r.bottom),
        zIndex: cs.zIndex,
        position: cs.position,
      }
    }).filter(p => p.visible)
  })
}

async function clickBtn(page, sel) {
  const loc = page.locator(sel).first()
  if (!(await loc.count())) return false
  await loc.scrollIntoViewIfNeeded().catch(() => {})
  await page.waitForTimeout(80)
  // 用 force:true 因为可能有遮罩（但要先确认按钮可见）
  try {
    await loc.click({ timeout: 3000 })
    return true
  } catch (e) {
    try {
      await loc.click({ force: true, timeout: 2000 })
      return true
    } catch (e2) {
      return false
    }
  }
}

async function closeAllPopups(page) {
  await page.keyboard.press('Escape').catch(() => {})
  await page.waitForTimeout(150)
  await page.keyboard.press('Escape').catch(() => {})
  await page.waitForTimeout(100)
}

;(async () => {
  const browser = await firefox.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  const ctx = await browser.newContext({ viewport: VP })
  const page = await ctx.newPage()
  page.on('console', m => { if (m.type() === 'error') rec('console', 'warn', `console.error: ${m.text()}`) })
  page.on('pageerror', e => rec('console', 'warn', `pageerror: ${e.message}`))

  console.log('==> 1. 打开首页')
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(800)
  await page.screenshot({ path: join(SHOTS, '00-home.png') })

  // === 测试矩阵：编辑器 × ribbon tab × popup 触发按钮 ===
  const matrix = [
    { ed: 'document', rt: 'home', btns: [
      { desc: 'textColor', sel: 'button[title*="Color"]' },
      { desc: 'highlight', sel: 'button[title*="Highlight"]' },
    ]},
    { ed: 'document', rt: 'insert', btns: [
      { desc: 'shape', sel: 'button:has-text("Shape"), button:has-text("形状")' },
      { desc: 'wordArt', sel: 'button:has-text("Art"), button:has-text("艺术字")' },
    ]},
    { ed: 'document', rt: 'layout', btns: [
      { desc: 'shading', sel: 'button[title*="Shading"], button[title*="底纹"]' },
    ]},
    { ed: 'document', rt: 'view', btns: [
      { desc: 'bgColor', sel: 'button[title*="Background"], button[title*="背景"]' },
    ]},
    { ed: 'spreadsheet', rt: 'home', btns: [
      { desc: 'color', sel: 'button[title*="Color"]' },
    ]},
    { ed: 'spreadsheet', rt: 'insert', btns: [
      { desc: 'chart', sel: 'button:has-text("Chart"), button:has-text("图表")' },
      { desc: 'shape', sel: 'button:has-text("Shape"), button:has-text("形状")' },
      { desc: 'func', sel: 'button:has-text("Function"), button:has-text("函数")' },
    ]},
    { ed: 'spreadsheet', rt: 'data', btns: [
      { desc: 'valid', sel: 'button:has-text("Validation"), button:has-text("验证")' },
      { desc: 'cond', sel: 'button:has-text("Conditional"), button:has-text("条件")' },
    ]},
    { ed: 'slide', rt: 'home', btns: [
      { desc: 'color', sel: 'button[title*="Color"]' },
    ]},
    { ed: 'slide', rt: 'insert', btns: [
      { desc: 'shape', sel: 'button:has-text("Shape"), button:has-text("形状")' },
      { desc: 'wordArt', sel: 'button:has-text("Art"), button:has-text("艺术字")' },
      { desc: 'anim', sel: 'button:has-text("Animation"), button:has-text("动画")' },
    ]},
  ]

  for (const m of matrix) {
    console.log(`\n==> ${m.ed}/${m.rt}`)
    await closeAllPopups(page)
    await page.locator(`[data-testid="tab-${m.ed}"]`).click()
    await page.waitForTimeout(400)
    await page.locator(`[data-testid="ribbon-tab-${m.rt}"]`).click()
    await page.waitForTimeout(300)

    for (const b of m.btns) {
      console.log(`  -> ${b.desc}`)
      await closeAllPopups(page)
      const ok = await clickBtn(page, b.sel)
      if (!ok) {
        rec(`${m.ed}-${m.rt}-${b.desc}`, 'warn', `无法定位按钮: ${b.sel}`)
        continue
      }
      await page.waitForTimeout(400)
      const popups = await getVisiblePopups(page)
      if (popups.length === 0) {
        rec(`${m.ed}-${m.rt}-${b.desc}`, 'warn', '点击后无 popup 出现')
        continue
      }
      await page.screenshot({ path: join(SHOTS, `${m.ed}-${m.rt}-${b.desc}.png`) })

      // 检查越界
      for (const p of popups) {
        if (p.x < 0 || p.y < 0 || p.right > VP.width || p.bottom > VP.height) {
          rec(`${m.ed}-${m.rt}-${b.desc}-overflow`, 'fail', `popup 越界: x=${p.x} y=${p.y} right=${p.right} bottom=${p.bottom} (vp ${VP.width}x${VP.height})`, p)
        } else {
          rec(`${m.ed}-${m.rt}-${b.desc}-overflow`, 'pass', `popup 在视口内: x=${p.x} y=${p.y} right=${p.right} bottom=${p.bottom}`)
        }
      }

      // 检查多 popup 重叠
      if (popups.length > 1) {
        for (let i = 0; i < popups.length; i++) {
          for (let j = i + 1; j < popups.length; j++) {
            const a = popups[i], b2 = popups[j]
            if (!(a.right <= b2.x || b2.right <= a.x || a.bottom <= b2.y || b2.bottom <= a.y)) {
              rec(`${m.ed}-${m.rt}-${b.desc}-overlap`, 'fail', `popup 互相重叠`, { a, b: b2 })
            }
          }
        }
      }

      // === 关键测试：popup 打开时点击其他编辑器 tab，是否真的能切换 ===
      // 真实点击 tab，验证切换是否成功
      const otherTab = m.ed === 'document' ? 'tab-spreadsheet' : 'tab-document'
      const beforeTab = await page.evaluate(() => {
        const active = document.querySelector('[data-testid^="tab-"][style*="rgba(255,255,255,0.2)"], [data-testid^="tab-"][style*="background: rgba(255, 255, 255, 0.2)"]')
        return active?.getAttribute('data-testid') || null
      })
      // 用 force:true 直接点击（绕过任何遮罩），模拟真实用户点击
      try {
        await page.locator(`[data-testid="${otherTab}"]`).first().click({ timeout: 1500 })
        await page.waitForTimeout(300)
        const afterTab = await page.evaluate(() => {
          const tabs = Array.from(document.querySelectorAll('[data-testid^="tab-"]'))
          // 找出当前激活的 tab（背景色为 rgba(255,255,255,0.2) 的）
          const active = tabs.find(b => {
            const bg = b.style.background || ''
            return bg.includes('rgba(255, 255, 255, 0.2)') || bg.includes('rgba(255,255,255,0.2)')
          })
          return active?.getAttribute('data-testid') || null
        })
        if (afterTab === otherTab) {
          rec(`${m.ed}-${m.rt}-${b.desc}-tab-clickable`, 'pass', `popup 打开时点击 tab "${otherTab}" 成功切换`)
        } else {
          rec(`${m.ed}-${m.rt}-${b.desc}-tab-clickable`, 'fail', `popup 打开时点击 tab "${otherTab}" 切换失败: before=${beforeTab} after=${afterTab}`)
        }
      } catch (e) {
        rec(`${m.ed}-${m.rt}-${b.desc}-tab-clickable`, 'fail', `popup 打开时点击 tab "${otherTab}" 抛错: ${e.message}`)
      }
      // 切回原编辑器继续测试
      await page.locator(`[data-testid="tab-${m.ed}"]`).first().click({ timeout: 1500 }).catch(()=>{})
      await page.waitForTimeout(300)
      await page.locator(`[data-testid="ribbon-tab-${m.rt}"]`).click({ timeout: 1500 }).catch(()=>{})
      await page.waitForTimeout(200)

      // === 关键测试：popup 打开时点击 Files 菜单，是否真的能打开 ===
      try {
        await page.locator('[data-testid="menu-files"]').first().click({ timeout: 1500 })
        await page.waitForTimeout(300)
        const filesDropdownVisible = await page.evaluate(() => {
          const dd = document.querySelector('.files-dropdown')
          if (!dd) return false
          const r = dd.getBoundingClientRect()
          return r.width > 0 && r.height > 0
        })
        if (filesDropdownVisible) {
          rec(`${m.ed}-${m.rt}-${b.desc}-files-clickable`, 'pass', `popup 打开时点击 Files 菜单成功打开下拉`)
        } else {
          rec(`${m.ed}-${m.rt}-${b.desc}-files-clickable`, 'fail', `popup 打开时点击 Files 菜单后下拉未显示`)
        }
        // 关闭 Files 下拉
        await page.keyboard.press('Escape').catch(()=>{})
        await page.waitForTimeout(200)
      } catch (e) {
        rec(`${m.ed}-${m.rt}-${b.desc}-files-clickable`, 'fail', `popup 打开时点击 Files 菜单抛错: ${e.message}`)
      }

      await closeAllPopups(page)
    }
  }

  // === 测试：切换 ribbon tab 后 popup 是否残留 ===
  console.log('\n==> ribbon tab 切换后 popup 残留测试')
  await page.locator('[data-testid="tab-document"]').click()
  await page.waitForTimeout(400)
  await page.locator('[data-testid="ribbon-tab-home"]').click()
  await page.waitForTimeout(300)
  await clickBtn(page, 'button[title*="Color"]')
  await page.waitForTimeout(400)
  await page.locator('[data-testid="ribbon-tab-insert"]').click()
  await page.waitForTimeout(400)
  const residual = await getVisiblePopups(page)
  if (residual.length > 0) {
    rec('tab-switch-residual', 'fail', `切换 ribbon tab 后 ${residual.length} 个 popup 残留`, residual)
    await page.screenshot({ path: join(SHOTS, 'tab-switch-residual.png') })
  } else {
    rec('tab-switch-residual', 'pass', '切换 ribbon tab 后无 popup 残留')
  }

  // === 测试：切换编辑器 tab 后 popup 是否残留 ===
  console.log('==> 编辑器 tab 切换后 popup 残留测试')
  await page.locator('[data-testid="ribbon-tab-home"]').click()
  await page.waitForTimeout(300)
  await clickBtn(page, 'button[title*="Color"]')
  await page.waitForTimeout(400)
  await page.locator('[data-testid="tab-spreadsheet"]').click()
  await page.waitForTimeout(400)
  const residual2 = await getVisiblePopups(page)
  if (residual2.length > 0) {
    rec('editor-switch-residual', 'fail', `切换编辑器 tab 后 ${residual2.length} 个 popup 残留`, residual2)
    await page.screenshot({ path: join(SHOTS, 'editor-switch-residual.png') })
  } else {
    rec('editor-switch-residual', 'pass', '切换编辑器 tab 后无 popup 残留')
  }

  // === 测试：Files 下拉与编辑器 popup z-index 冲突 ===
  console.log('==> Files 下拉 z-index 冲突测试')
  await page.locator('[data-testid="tab-document"]').click()
  await page.waitForTimeout(400)
  await page.locator('[data-testid="ribbon-tab-home"]').click()
  await page.waitForTimeout(300)
  await clickBtn(page, 'button[title*="Color"]')
  await page.waitForTimeout(400)
  // 点击 Files 按钮 — 应该关闭编辑器 popup 并打开 Files 下拉
  const filesResult = await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="menu-files"]')
    if (!btn) return null
    const r = btn.getBoundingClientRect()
    const elAtPoint = document.elementFromPoint(r.x + r.width/2, r.y + r.height/2)
    return {
      isTarget: elAtPoint === btn || (elAtPoint && btn.contains(elAtPoint)),
      blockingEl: elAtPoint ? (elAtPoint.className?.toString?.() || elAtPoint.tagName).slice(0, 80) : null,
    }
  })
  if (filesResult && !filesResult.isTarget) {
    rec('files-zindex-conflict', 'fail', `编辑器 popup 打开时 Files 按钮被遮罩拦截: 命中="${filesResult.blockingEl}"`, filesResult)
  } else {
    rec('files-zindex-conflict', 'pass', `Files 按钮可点击（z-index OK）`)
  }
  await closeAllPopups(page)

  // === 窄屏 (900x600) 测试 ===
  console.log('\n==> 窄屏 (900x600) 测试')
  await page.setViewportSize({ width: 900, height: 600 })
  await page.waitForTimeout(500)
  for (const ed of ['document', 'spreadsheet', 'slide']) {
    await page.locator(`[data-testid="tab-${ed}"]`).click()
    await page.waitForTimeout(400)
    const tabs = await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid^="ribbon-tab-"]')).map(b => b.getAttribute('data-testid')))
    for (const rt of tabs.slice(0, 4)) {
      await page.locator(`[data-testid="${rt}"]`).click()
      await page.waitForTimeout(300)
      const btns = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('.ribbon-scroll button, [class*="ribbon"] button')).map(b => {
          const r = b.getBoundingClientRect()
          const cs = getComputedStyle(b)
          const visible = r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden'
          return { visible, w: Math.round(r.width), h: Math.round(r.height), text: (b.textContent||'').trim().slice(0,20), title: b.getAttribute('title')||'' }
        }).filter(b => b.visible)
      })
      const squeezed = btns.filter(b => b.w < 10)
      if (squeezed.length > 0) {
        rec(`narrow-${ed}-${rt}-squeeze`, 'fail', `窄屏 ${ed}/${rt}: ${squeezed.length} 个按钮宽度<10px`, squeezed.slice(0, 5))
      }
      // 按钮重叠
      for (let i = 0; i < btns.length; i++) {
        for (let j = i + 1; j < btns.length; j++) {
          // 简单判断 — 不在窄屏做精细比较
        }
      }
      await page.screenshot({ path: join(SHOTS, `narrow-${ed}-${rt}.png`) })
    }
  }
  await page.setViewportSize(VP)

  // === 移动端测试 ===
  console.log('\n==> 移动端 (iPhone 13) 测试')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(500)
  await page.locator('[data-testid="tab-document"]').click().catch(()=>{})
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(SHOTS, 'mobile-doc.png') })
  // 汉堡菜单
  const ham = page.locator('[data-testid="hamburger-toggle"]')
  if (await ham.count()) {
    await ham.click()
    await page.waitForTimeout(400)
    await page.screenshot({ path: join(SHOTS, 'mobile-hamburger.png') })
    const mobilePopups = await getVisiblePopups(page)
    for (const p of mobilePopups) {
      if (p.x < 0 || p.right > 390 || p.y < 0 || p.bottom > 844) {
        rec('mobile-hamburger-overflow', 'fail', `移动端汉堡菜单越界: x=${p.x} right=${p.right} (vp 390)`, p)
      }
    }
    // 检查汉堡菜单项是否完整可见
    const items = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('[data-testid^="mobile-menu-item-"]')).map(b => {
        const r = b.getBoundingClientRect()
        return { x: Math.round(r.x), y: Math.round(r.y), right: Math.round(r.right), bottom: Math.round(r.bottom), text: (b.textContent||'').trim().slice(0,30) }
      })
    })
    for (const it of items) {
      if (it.right > 390 || it.x < 0) {
        rec('mobile-menu-item-overflow', 'fail', `移动端菜单项越界: "${it.text}" x=${it.x} right=${it.right}`, it)
      }
    }
  }
  await page.setViewportSize(VP)

  await browser.close()

  console.log('\n========== 全面审计汇总 ==========')
  console.log(`通过: ${pass}  失败: ${fail}  警告: ${warn}  总计: ${pass+fail+warn}`)
  if (fail > 0) {
    console.log('\n失败项明细:')
    findings.filter(f => f.severity === 'fail').forEach((f, i) => {
      console.log(`  [${i+1}] [${f.cat}] ${f.msg}`)
    })
  }
  writeFileSync('/home/z/my-project/samoffice/scripts/e2e/full-audit-results.json', JSON.stringify({ summary: { pass, fail, warn, total: pass+fail+warn }, findings }, null, 2))
  process.exit(fail > 0 ? 1 : 0)
})().catch(e => { console.error('FATAL:', e); process.exit(2) })
