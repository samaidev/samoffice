// debug-all-popups.mjs - 检查所有编辑器的所有 popup 坐标
import { firefox } from 'playwright'

const BASE = 'http://127.0.0.1:18400'

const editors = [
  { tab: 'document', ribbonTabs: ['home', 'insert', 'layout', 'view'] },
  { tab: 'spreadsheet', ribbonTabs: ['home', 'insert', 'data', 'view'] },
  { tab: 'slide', ribbonTabs: ['home', 'insert', 'design', 'transition', 'animations', 'view'] },
]

const popupTriggers = [
  { name: 'Color', selectors: ['button[title*="Color"]', 'button[title*="颜色"]', 'button[title*="color"]'] },
  { name: 'Highlight', selectors: ['button[title*="Highlight"]', 'button[title*="高亮"]'] },
  { name: 'Shapes', selectors: ['button:has-text("Shape")', 'button:has-text("形状")'] },
  { name: 'WordArt', selectors: ['button:has-text("WordArt")', 'button:has-text("Art")', 'button:has-text("艺术字")'] },
  { name: 'Shading', selectors: ['button[title*="Shading"]', 'button[title*="底纹"]'] },
  { name: 'Background', selectors: ['button[title*="Background"]', 'button[title*="背景"]'] },
  { name: 'Chart', selectors: ['button:has-text("Chart")', 'button:has-text("图表")'] },
]

async function getRect(loc) {
  try {
    const box = await loc.boundingBox()
    if (!box) return null
    return { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height), right: Math.round(box.x + box.width), bottom: Math.round(box.y + box.height) }
  } catch { return null }
}

;(async () => {
  const browser = await firefox.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await ctx.newPage()
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(800)

  const issues = []

  for (const ed of editors) {
    console.log(`\n=== ${ed.tab} ===`)
    await page.locator(`[data-testid="tab-${ed.tab}"]`).click()
    await page.waitForTimeout(400)

    for (const rt of ed.ribbonTabs) {
      const ribbonTab = page.locator(`[data-testid="ribbon-tab-${rt}"]`)
      if (!(await ribbonTab.count())) continue
      await ribbonTab.click()
      await page.waitForTimeout(300)

      for (const trigger of popupTriggers) {
        let btn = null
        for (const sel of trigger.selectors) {
          const loc = page.locator(sel).first()
          if (await loc.count()) { btn = loc; break }
        }
        if (!btn) continue

        // 关闭所有 popup
        await page.mouse.click(640, 400)
        await page.waitForTimeout(150)

        const btnRect = await getRect(btn)
        if (!btnRect) continue

        await btn.click()
        await page.waitForTimeout(400)

        const popups = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('.ribbon-popup')).filter(p => {
            const r = p.getBoundingClientRect()
            return r.width > 0 && r.height > 0
          }).map(p => {
            const r = p.getBoundingClientRect()
            return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom) }
          })
        })

        if (popups.length === 0) continue

        // 检查 popup 是否覆盖了 group label
        // group label 在按钮底部下方 0-25px 处
        for (const p of popups) {
          // group label 区域: btnRect.bottom 到 btnRect.bottom + 25
          const labelTop = btnRect.bottom
          const labelBottom = btnRect.bottom + 25
          if (p.y < labelBottom) {
            const overlap = Math.min(p.bottom, labelBottom) - Math.max(p.y, labelTop)
            if (overlap > 0) {
              issues.push({ editor: ed.tab, ribbon: rt, trigger: trigger.name, issue: 'popup-overlaps-group-label', popupY: p.y, labelBottom, overlap })
              console.log(`  [FAIL] ${ed.tab}/${rt} ${trigger.name}: popup y=${p.y} 与 group label (bottom=${labelBottom}) 重叠 ${overlap}px`)
            }
          }
          // 越界检查
          if (p.x < 0 || p.y < 0 || p.right > 1280 || p.bottom > 800) {
            issues.push({ editor: ed.tab, ribbon: rt, trigger: trigger.name, issue: 'popup-overflow', popup: p })
            console.log(`  [FAIL] ${ed.tab}/${rt} ${trigger.name}: popup 越界 ${JSON.stringify(p)}`)
          }
        }

        // 检查 popup 是否覆盖了相邻 ribbon 按钮
        const allButtons = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('.ribbon-scroll button, .ribbon-group button')).map(b => {
            const r = b.getBoundingClientRect()
            return { text: (b.textContent || '').trim().slice(0, 20), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom) }
          }).filter(b => b.w > 5 && b.h > 5)
        })
        for (const p of popups) {
          for (const b of allButtons) {
            // 跳过 popup 内部的按钮
            if (b.x >= p.x && b.right <= p.right && b.y >= p.y && b.bottom <= p.bottom) continue
            // 跳过触发按钮本身
            if (b.x === btnRect.x && b.y === btnRect.y) continue
            // 检查重叠
            const overlapX = Math.max(0, Math.min(p.right, b.right) - Math.max(p.x, b.x))
            const overlapY = Math.max(0, Math.min(p.bottom, b.bottom) - Math.max(p.y, b.y))
            if (overlapX > 5 && overlapY > 5) {
              issues.push({ editor: ed.tab, ribbon: rt, trigger: trigger.name, issue: 'popup-overlaps-button', button: b.text, buttonRect: b, popupRect: p })
              console.log(`  [FAIL] ${ed.tab}/${rt} ${trigger.name}: popup 覆盖按钮 "${b.text}" overlap=${overlapX}x${overlapY}`)
            }
          }
        }

        await page.mouse.click(640, 400)
        await page.waitForTimeout(200)
      }
    }
  }

  console.log(`\n========== 总计 ${issues.length} 个问题 ==========`)
  await browser.close()
  process.exit(issues.length > 0 ? 1 : 0)
})().catch(e => { console.error('FATAL:', e); process.exit(2) })
