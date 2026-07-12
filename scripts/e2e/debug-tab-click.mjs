import { firefox } from 'playwright'
const b = await firefox.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const p = await b.newPage({ viewport: { width: 1280, height: 800 } })
await p.goto('http://localhost:18400/', { waitUntil: 'networkidle', timeout: 15000 })
await p.waitForTimeout(1500)

// 切到 spreadsheet
await p.locator('[data-testid="tab-spreadsheet"]').click({ timeout: 3000 })
await p.waitForTimeout(500)
console.log('After spreadsheet click')

// 收集所有 fixed/absolute 定位元素（可能遮挡 tab）
const overlays = await p.evaluate(() => {
  const all = Array.from(document.querySelectorAll('*'))
  return all.map(el => {
    const cs = getComputedStyle(el)
    if ((cs.position === 'fixed' || cs.position === 'absolute') && cs.display !== 'none' && cs.visibility !== 'hidden') {
      const r = el.getBoundingClientRect()
      const opacity = parseFloat(cs.opacity)
      if (r.width > 100 && r.height > 100) {
        return {
          tag: el.tagName,
          cls: (el.className?.toString?.() || '').slice(0, 80),
          pos: cs.position,
          x: Math.round(r.x), y: Math.round(r.y),
          w: Math.round(r.width), h: Math.round(r.height),
          zIndex: cs.zIndex,
          opacity,
        }
      }
    }
    return null
  }).filter(Boolean)
})
console.log('Overlays:', JSON.stringify(overlays, null, 2))

// 检查 slide tab 的位置和遮挡
const slideTab = await p.locator('[data-testid="tab-slide"]').boundingBox()
console.log('slide tab bbox:', slideTab)
if (slideTab) {
  // 检查这个位置上有什么元素
  const elemAtPoint = await p.evaluate(({x, y}) => {
    const el = document.elementFromPoint(x, y)
    return el ? {
      tag: el.tagName,
      cls: (el.className?.toString?.() || '').slice(0, 80),
      id: el.id,
      text: (el.textContent || '').trim().slice(0, 40),
    } : null
  }, { x: slideTab.x + slideTab.width / 2, y: slideTab.y + slideTab.height / 2 })
  console.log('element at slide tab center:', elemAtPoint)
}
await p.screenshot({ path: '/tmp/debug-spreadsheet-state.png' })
await b.close()
