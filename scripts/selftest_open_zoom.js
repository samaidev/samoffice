const { firefox } = require('playwright')
const URL = 'http://127.0.0.1:5199/'

const DOC = {
  path: 'probe.docx',
  document: { meta: { title: 'probe' }, blocks: [{ inline: [{ content: 'original text for zoom test' }] }] },
}

;(async () => {
  const browser = await firefox.launch()
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', e => errors.push('[pageerror] ' + e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push('[console.error] ' + m.text()) })

  await page.route('**/api/doc/open', r => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(DOC),
  }))

  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(1500)

  const dt = await page.evaluateHandle(() => {
    const d = new DataTransfer()
    d.items.add(new File([new Uint8Array([80, 75, 3, 4])], 'probe.docx',
      { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }))
    return d
  })
  await page.locator('#root > div').first().dispatchEvent('drop', { dataTransfer: dt })
  await page.waitForSelector('.ProseMirror', { timeout: 10000 }).catch(() => {})
  await page.waitForTimeout(1500)

  async function snap(tag) {
    return await page.evaluate(t => {
      const pm = document.querySelector('.ProseMirror')
      const scaleDivs = Array.from(document.querySelectorAll('div')).filter(d => /scale\(/.test(d.getAttribute('style') || ''))
      const appZoomInput = document.querySelector('footer input[type="number"]')
      return {
        tag: t,
        hasProseMirror: !!pm,
        pmTextLen: pm ? (pm.innerText || '').length : -1,
        scaleValues: scaleDivs.slice(0, 3).map(d => (d.getAttribute('style').match(/scale\([^)]+\)/g) || []).join(',')),
        appZoomInputValue: appZoomInput ? appZoomInput.value : 'NONE',
      }
    }, tag)
  }

  console.log('AFTER OPEN:', JSON.stringify(await snap('open'), null, 1))

  // 测试 1: App 右下角 zoom in 按钮 (title 含 放大)
  const zin = await page.$('button[title*="Zoom"]')
  console.log('found app zoom-in:', !!zin)
  if (zin) { await zin.click(); console.log('clicked app zoom-in'); await page.waitForTimeout(800) }
  console.log('AFTER APP ZOOMIN:', JSON.stringify(await snap('app-zoomin'), null, 1))

  // 测试 2: Ctrl+= 键盘缩放
  await page.keyboard.press('Control+Equal')
  await page.waitForTimeout(800)
  console.log('AFTER CTRL+=:', JSON.stringify(await snap('ctrl'), null, 1))

  console.log('ERRORS:', errors.slice(0, 20).join('\n'))
  await browser.close()
})()
