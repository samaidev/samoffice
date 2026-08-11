import { chromium } from 'playwright'

const URL = 'http://localhost:34115'
const DOC = 'C:/samoffice/build/long_para.docx'

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
  const errors = []
  page.on('pageerror', (e) => errors.push('[PAGEERROR] ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push('[console.error] ' + m.text()) })

  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(3500)

  await page.waitForFunction(() => !!(window.go && window.go.main && window.go.main.App && window.go.main.App.OpenFile), {}, { timeout: 15000 })

  const openRes = await page.evaluate(async (docPath) => {
    try {
      return await window.go.main.App.OpenFile(docPath)
    } catch (e) {
      return { error: String(e) }
    }
  }, DOC)
  console.log('OPEN RESULT:', JSON.stringify(openRes, null, 1).slice(0, 200))
  await page.waitForTimeout(4000)

  const snap = async (tag) =>
    page.evaluate((t) => {
      const pm = document.querySelector('.ProseMirror')
      return {
        tag: t,
        hasProseMirror: !!pm,
        pmTextLen: pm ? (pm.innerText || '').length : -1,
        pmHTMLLen: pm ? pm.innerHTML.length : -1,
        bodyTextSample: (document.body.innerText || '').slice(0, 100),
      }
    }, tag)

  console.log('AFTER OPEN:', JSON.stringify(await snap('open'), null, 1))
  console.log('ERRORS:', errors.slice(0, 20).join('\n'))
  await browser.close()
}

main()
