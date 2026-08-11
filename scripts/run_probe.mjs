import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage()
const logs = []
page.on('console', (m) => logs.push(m.text()))
await page.goto('file:///c:/samoffice/scripts/pagination_probe.html', { waitUntil: 'load' })
await page.waitForTimeout(500)
const probe = await page.evaluate(() => window.__PROBE)
console.log('=== PROBE RESULT ===')
console.log(JSON.stringify(probe, null, 2))
await browser.close()
