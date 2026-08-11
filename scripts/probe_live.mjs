import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage()
const logs = []
page.on('console', (m) => logs.push('[' + m.type() + '] ' + m.text()))
page.on('pageerror', (e) => logs.push('[PAGEERROR] ' + e.message))
await page.goto('http://localhost:5173/', { waitUntil: 'load', timeout: 30000 })
await page.waitForTimeout(6000)
const info = await page.evaluate(() => ({
  hasGo: !!window.go,
  hasProseMirror: !!document.querySelector('.ProseMirror'),
  pg: window.__pg || null,
  bodyTop: window.__bodyTop || null,
  editorExists: !!document.querySelector('[class*="ProseMirror"], .editor-host, #editor'),
  bodyText: document.body.innerText.slice(0, 200)
}))
console.log('=== LIVE INFO ===')
console.log(JSON.stringify(info, null, 2))
console.log('=== CONSOLE LOGS (last 30) ===')
console.log(logs.slice(-30).join('\n'))
await browser.close()
