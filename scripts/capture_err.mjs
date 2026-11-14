import { chromium } from 'playwright'

const URL = 'http://localhost:34115'
const DOC = 'C:/samoffice/build/long_para.docx'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
page.on('pageerror', (e) => console.log('PAGEERROR_STACK:\n' + (e.stack || e.message)))
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE_ERROR:', m.text())
})

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(2500)
await page.waitForFunction(() => !!(window.go && window.go.main && window.go.main.App && window.go.main.App.OpenFile), {}, { timeout: 15000 })

await page.evaluate(async (docPath) => {
  try { return await window.go.main.App.OpenFile(docPath) } catch (e) { return { error: String(e) } }
}, DOC)
await page.waitForTimeout(6000)

const info = await page.evaluate(() => ({
  hasPM: !!document.querySelector('.ProseMirror'),
  rootText: (document.querySelector('#root')?.innerText || '').slice(0, 200),
}))
console.log('INFO:', JSON.stringify(info))
await browser.close()
