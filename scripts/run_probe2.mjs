import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage()
const logs = []
page.on('console', (m) => logs.push(m.text()))
await page.goto('file:///c:/samoffice/scripts/pagination_probe2.html', { waitUntil: 'load' })
await page.waitForTimeout(400)
const probe = await page.evaluate(() => window.__PROBE2)
const errs = logs.filter(l => !l.startsWith('PROBE2'))
console.log('ERRORS:', errs.join('\n'))
console.log(JSON.stringify(probe, null, 2))
await browser.close()
