// slide-layout-check.mjs
import { firefox } from 'playwright'
import { mkdirSync } from 'fs'
import { join } from 'path'

const BASE = 'http://127.0.0.1:18400'
const SHOTS = '/home/z/my-project/samoffice/scripts/e2e/pw-shots-overlap'
mkdirSync(SHOTS, { recursive: true })

;(async () => {
  const browser = await firefox.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await ctx.newPage()
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(800)
  await page.locator('[data-testid="tab-slide"]').click()
  await page.waitForTimeout(500)
  await page.locator('[data-testid="ribbon-tab-home"]').click()
  await page.waitForTimeout(300)

  // 检查所有 ribbon group label 的实际渲染
  const labels = await page.evaluate(() => {
    const groups = Array.from(document.querySelectorAll('.ribbon-group, [class*="ribbon-group"]'))
    // 也检查所有 ribbon 内的小文字
    const smallTexts = Array.from(document.querySelectorAll('.ribbon-scroll div, .ribbon-scroll span'))
      .filter(el => {
        const cs = getComputedStyle(el)
        const r = el.getBoundingClientRect()
        return cs.fontSize.includes('10px') && r.width > 0 && r.height > 0 && (el.textContent || '').trim().length > 0 && (el.textContent || '').trim().length < 30
      })
    return {
      groups: groups.map(g => {
        const r = g.getBoundingClientRect()
        const cs = getComputedStyle(g)
        return { txt: (g.textContent || '').trim().slice(0, 50), w: Math.round(r.width), h: Math.round(r.height), overflow: cs.overflow, overflowX: cs.overflowX, overflowY: cs.overflowY }
      }),
      smallTexts: smallTexts.map(el => {
        const r = el.getBoundingClientRect()
        const cs = getComputedStyle(el)
        const parent = el.parentElement
        const pr = parent.getBoundingClientRect()
        const pcs = getComputedStyle(parent)
        return {
          txt: (el.textContent || '').trim(),
          w: Math.round(r.width), h: Math.round(r.height),
          parentW: Math.round(pr.width),
          parentOverflow: pcs.overflow,
          whiteSpace: cs.whiteSpace,
          textOverflow: cs.textOverflow,
        }
      }).filter(t => t.w < t.txt.length * 5) // 看起来被截断的
    }
  })
  console.log('=== Groups ===')
  labels.groups.forEach((g, i) => console.log(`  [${i}] w=${g.w} h=${g.h} overflow=${g.overflow}/${g.overflowX}/${g.overflowY} txt="${g.txt}"`))
  console.log('\n=== Potentially truncated small texts ===')
  labels.smallTexts.forEach((t, i) => console.log(`  [${i}] txt="${t.txt}" w=${t.w} parentW=${t.parentW} parentOverflow=${t.parentOverflow} whiteSpace=${t.whiteSpace} textOverflow=${t.textOverflow}`))

  await page.screenshot({ path: join(SHOTS, 'slide-ribbon-zoom.png') })

  // 放大截图 ribbon 区域
  const ribbonBox = await page.evaluate(() => {
    const el = document.querySelector('.ribbon-scroll')
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
  })
  if (ribbonBox) {
    await page.screenshot({ path: join(SHOTS, 'slide-ribbon-only.png'), clip: { x: ribbonBox.x, y: ribbonBox.y, width: ribbonBox.w, height: ribbonBox.h } })
  }

  await browser.close()
})().catch(e => { console.error('FATAL:', e); process.exit(2) })
