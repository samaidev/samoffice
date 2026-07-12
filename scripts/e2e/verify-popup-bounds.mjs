// verify-popup-bounds.mjs - 精确测量 popup 边界，验证不越界
import { firefox } from 'playwright'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

const BASE = 'http://localhost:18400'
const SHOTS = '/home/z/my-project/samoffice/scripts/e2e/verify-shots'
mkdirSync(SHOTS, { recursive: true })

const VW = 1280, VH = 800
const findings = []

async function safe(fn, label) {
  try { return await fn() } catch (e) {
    findings.push({ label, error: e.message.slice(0, 150) })
    return null
  }
}

async function measurePopups(page) {
  return await page.evaluate(() => {
    const sels = '.ribbon-popup, .files-dropdown'
    return Array.from(document.querySelectorAll(sels)).map((p, i) => {
      const r = p.getBoundingClientRect()
      const cs = getComputedStyle(p)
      const visible = r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.05
      return {
        i, visible,
        x: Math.round(r.x), y: Math.round(r.y),
        w: Math.round(r.width), h: Math.round(r.height),
        right: Math.round(r.right), bottom: Math.round(r.bottom),
        left: cs.left, right_css: cs.right, top: cs.top, bottom_css: cs.bottom,
        cls: (p.className?.toString?.() || '').slice(0, 80),
      }
    }).filter(p => p.visible)
  })
}

const TABS = [
  { id: 'tab-document', name: 'document' },
  { id: 'tab-spreadsheet', name: 'spreadsheet' },
  { id: 'tab-slide', name: 'slide' },
]

;(async () => {
  const browser = await firefox.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH } })
  const page = await ctx.newPage()

  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 20000 })
  await page.waitForTimeout(1500)

  let totalPopups = 0, overflowPopups = 0

  for (const tab of TABS) {
    console.log(`==> ${tab.name}`)
    await safe(async () => {
      await page.locator(`[data-testid="${tab.id}"]`).click({ timeout: 5000 })
      await page.waitForTimeout(500)
    }, `tab-${tab.name}`)

    const ribbonTabs = await safe(async () => {
      return await page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-testid^="ribbon-tab-"]')).map(b => ({
          id: b.getAttribute('data-testid'),
        }))
      )
    }, `ribbon-tabs-${tab.name}`) || []

    for (const rt of ribbonTabs) {
      await safe(async () => {
        await page.locator(`[data-testid="${rt.id}"]`).click({ timeout: 3000 })
        await page.waitForTimeout(300)
      }, `click-${rt.id}`)

      // 找所有可能触发 popup 的按钮
      const triggers = await safe(async () => {
        return await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('.ribbon-scroll button, .toolbar button'))
          return btns.map((b, i) => {
            const r = b.getBoundingClientRect()
            const cs = getComputedStyle(b)
            const visible = r.width > 0 && r.height > 0 && cs.display !== 'none'
            const parent = b.parentElement
            const hasRelativeParent = parent?.classList.contains('relative') || parent?.closest('.relative')
            return {
              i, visible,
              cx: Math.round(r.x + r.width / 2),
              cy: Math.round(r.y + r.height / 2),
              w: Math.round(r.width),
              title: b.getAttribute('title') || '',
              text: (b.textContent || '').trim().slice(0, 20),
              hasRelativeParent: !!hasRelativeParent,
            }
          }).filter(b => b.visible && b.w > 5 && b.hasRelativeParent)
        })
      }, `triggers-${tab.name}-${rt.id}`) || []

      for (const btn of triggers) {
        await safe(async () => {
          await page.mouse.click(10, 10)
          await page.waitForTimeout(80)
          await page.mouse.click(btn.cx, btn.cy)
          await page.waitForTimeout(300)
          const popups = await measurePopups(page)
          for (const p of popups) {
            totalPopups++
            const overflowRight = p.right > VW
            const overflowBottom = p.bottom > VH
            const overflowLeft = p.x < 0
            const overflowTop = p.y < 0
            if (overflowRight || overflowBottom || overflowLeft || overflowTop) {
              overflowPopups++
              const label = `${tab.name}/${rt.id}/btn${btn.i}(${btn.title || btn.text})`
              console.log(`  ❌ 越界: ${label} popup[${p.x},${p.y},${p.right},${p.bottom}] css(left=${p.left},right=${p.right_css},top=${p.top},bottom=${p.bottom_css})`)
              findings.push({ label, popup: p, overflow: { overflowRight, overflowBottom, overflowLeft, overflowTop } })
              await page.screenshot({ path: join(SHOTS, `overflow-${tab.name}-${rt.id}-btn${btn.i}.png`) })
            }
          }
        }, `measure-${tab.name}-${rt.id}-btn${btn.i}`)
      }
    }
  }

  console.log(`\n=== 总结 ===`)
  console.log(`测量 popup 总数: ${totalPopups}`)
  console.log(`越界 popup 数: ${overflowPopups}`)
  console.log(`通过率: ${((totalPopups - overflowPopups) / Math.max(totalPopups, 1) * 100).toFixed(1)}%`)

  writeFileSync('/home/z/my-project/samoffice/scripts/e2e/verify-bounds-report.json', JSON.stringify({
    totalPopups, overflowPopups,
    passRate: ((totalPopups - overflowPopups) / Math.max(totalPopups, 1) * 100).toFixed(1) + '%',
    findings,
  }, null, 2))

  await browser.close()
})().catch(e => { console.error('FATAL:', e); process.exit(1) })
