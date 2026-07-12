// quick-shots.mjs - 快速截取所有 Tab + Ribbon 状态
import { firefox } from 'playwright'
import { mkdirSync } from 'fs'
import { join } from 'path'

const BASE = 'http://localhost:18400'
const SHOTS = '/home/z/my-project/samoffice/scripts/e2e/quick-shots'
mkdirSync(SHOTS, { recursive: true })

const TABS = ['document', 'spreadsheet', 'slide', 'markdown', 'html']

;(async () => {
  const browser = await firefox.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await ctx.newPage()

  const errors = []
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', e => errors.push(e.message))

  console.log('==> 首页')
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 20000 })
  await page.waitForTimeout(1500)
  await page.screenshot({ path: join(SHOTS, '00-home.png'), fullPage: false })

  for (const tab of TABS) {
    console.log(`==> ${tab}`)
    try {
      await page.locator(`[data-testid="tab-${tab}"]`).click({ timeout: 5000 })
      await page.waitForTimeout(800)
      await page.screenshot({ path: join(SHOTS, `tab-${tab}.png`) })

      // 收集 ribbon tabs
      const ribbonTabs = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-testid^="ribbon-tab-"]')).map(b => ({
          id: b.getAttribute('data-testid'),
          label: (b.textContent || '').trim()
        }))
      )
      console.log(`  ${tab}: ${ribbonTabs.length} ribbon tabs`)

      for (const rt of ribbonTabs) {
        try {
          await page.locator(`[data-testid="${rt.id}"]`).click({ timeout: 3000 })
          await page.waitForTimeout(400)
          await page.screenshot({ path: join(SHOTS, `${tab}-${rt.id}.png`) })

          // 收集所有按钮并 hover 一次（不分别截图，仅检测 popup）
          const buttons = await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('.ribbon-scroll button, .toolbar button, [class*="ribbon"] button, [class*="toolbar"] button'))
            return btns.map((b, i) => {
              const r = b.getBoundingClientRect()
              const cs = getComputedStyle(b)
              const visible = r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden'
              return {
                i, visible,
                cx: Math.round(r.x + r.width / 2),
                cy: Math.round(r.y + r.height / 2),
                w: Math.round(r.width), h: Math.round(r.height),
                title: b.getAttribute('title') || '',
                text: (b.textContent || '').trim().slice(0, 20),
              }
            }).filter(b => b.visible && b.w > 5)
          })

          // 对前 15 个按钮做 hover 测试，检测 popup
          let popupIssues = 0
          for (const btn of buttons.slice(0, 15)) {
            try {
              // 关闭现有 popup
              await page.mouse.click(10, 10)
              await page.waitForTimeout(80)
              // hover
              await page.mouse.move(btn.cx, btn.cy)
              await page.waitForTimeout(200)
              const popups = await page.evaluate(() => {
                const sels = '.ribbon-popup, .files-dropdown, [class*="popup"], [class*="dropdown"], [role="menu"], [role="listbox"]'
                return Array.from(document.querySelectorAll(sels)).map(p => {
                  const r = p.getBoundingClientRect()
                  const cs = getComputedStyle(p)
                  const visible = r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.05
                  return {
                    visible, x: Math.round(r.x), y: Math.round(r.y),
                    w: Math.round(r.width), h: Math.round(r.height),
                    right: Math.round(r.right), bottom: Math.round(r.bottom),
                    zIndex: cs.zIndex,
                    cls: (p.className?.toString?.() || '').slice(0, 100),
                    text: (p.textContent || '').trim().slice(0, 50),
                  }
                }).filter(p => p.visible)
              })
              if (popups.length > 0) {
                // 检查越界
                for (const p of popups) {
                  if (p.x < 0 || p.y < 0 || p.right > 1280 || p.bottom > 800) {
                    console.log(`  ❌ 越界: ${tab}/${rt.id}/btn${btn.i}(${btn.title || btn.text}) popup [${p.x},${p.y},${p.right},${p.bottom}] cls="${p.cls}"`)
                    popupIssues++
                  }
                }
                // 检查重叠
                for (let i = 0; i < popups.length; i++) {
                  for (let j = i + 1; j < popups.length; j++) {
                    const a = popups[i], b = popups[j]
                    if (!(a.right <= b.x || b.right <= a.x || a.bottom <= b.y || b.bottom <= a.y)) {
                      console.log(`  ❌ 重叠: ${tab}/${rt.id}/btn${btn.i}(${btn.title || btn.text}) popup#${i}↔#${j}`)
                      popupIssues++
                    }
                  }
                }
                // 截图第一个有 popup 的状态
                if (popupIssues > 0 || (btn.i < 5 && popups.length > 0)) {
                  await page.screenshot({ path: join(SHOTS, `${tab}-${rt.id}-btn${btn.i}-${(btn.title || btn.text).replace(/[^a-zA-Z0-9]/g, '').slice(0, 15)}.png`) })
                }
              }
            } catch (e) {}
          }
          if (popupIssues > 0) {
            console.log(`  ${tab}/${rt.id}: ${popupIssues} 个 popup 问题`)
          }
        } catch (e) {
          console.log(`  ribbon ${rt.id} 错误: ${e.message.slice(0, 100)}`)
        }
      }
    } catch (e) {
      console.log(`${tab} tab 错误: ${e.message.slice(0, 100)}`)
    }
  }

  console.log(`\n==> Console errors: ${errors.length}`)
  errors.slice(0, 5).forEach(e => console.log(`  - ${e.slice(0, 150)}`))

  await browser.close()
  console.log('=== 完成 ===')
})().catch(e => { console.error('FATAL:', e); process.exit(1) })
