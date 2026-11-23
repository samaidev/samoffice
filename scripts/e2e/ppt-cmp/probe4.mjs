import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
await p.goto('http://localhost:18400', { waitUntil: 'networkidle' })
await p.waitForTimeout(800)
await p.evaluate(() => { localStorage.setItem('samoffice_lang', 'zh') })
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(1000)
await p.locator('[data-testid="menu-files"]').click({ force: true }); await p.waitForTimeout(400)
const [ch] = await Promise.all([p.waitForEvent('filechooser', { timeout: 10000 }), (async () => { await p.locator('text=📂').first().click({ force: true }) })()])
await ch.setFiles('/home/z/my-project/upload/装备工业的互联网 机遇.pptx')
await p.waitForTimeout(4000)
for (const idx of [2, 12]) {
  await p.evaluate((i) => {
    const list = document.querySelector('.w-40, .w-48')
    const cards = list?.querySelectorAll('.space-y-2 > div')
    cards?.[i]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  }, idx)
  await p.waitForTimeout(800)
  const html = await p.evaluate(() => {
    const cv = document.querySelector('.slide-canvas')
    const spans = Array.from((cv || document).querySelectorAll('span'))
    const hit = spans.find(x => /金融实践|淘宝/.test(x.textContent || ''))
    // 找到含正文的形状容器（absolute 层）
    let el = hit
    while (el && el.parentElement && !el.className.toString().includes('absolute flex')) el = el.parentElement
    return el ? el.innerHTML.slice(0, 700) : 'NOT FOUND'
  })
  console.log(`--- slide${idx + 1} shape html ---`)
  console.log(html.slice(0, 600))
}
await b.close()
