import { chromium } from 'playwright'

const browser = await chromium.launch()
const page = await browser.newPage()
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push('PAGEERR: ' + e.message))

await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(4000)
const hasEditor = await page.$('.ProseMirror')
console.log('HAS_EDITOR:', !!hasEditor)
if (!hasEditor) {
  const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 400))
  const html = await page.evaluate(() => document.body.innerHTML.slice(0, 600))
  console.log('NO_EDITOR bodyText:', JSON.stringify(bodyText))
  console.log('NO_EDITOR html:', JSON.stringify(html))
  console.log('ERRORS:', errors.slice(0, 10))
  await browser.close()
  process.exit(0)
}

// 聚焦编辑器并输入多段文字，制造多页
await page.click('.ProseMirror')
const para = '这是一段用于分页测试的普通文字。'
for (let i = 0; i < 60; i++) {
  await page.keyboard.type(para)
  await page.keyboard.press('Enter')
}
await page.waitForTimeout(800)

const data = await page.evaluate(() => {
  const pm = document.querySelector('.ProseMirror')
  const blocks = Array.from(pm.children)
  const blockInfo = blocks.map((b) => {
    const r = b.getBoundingClientRect()
    return { tag: b.tagName, top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) }
  })
  // 纸页背景 div：带 border-radius:8px 且 background 非 transparent
  const pages = Array.from(document.querySelectorAll('div')).filter((d) => {
    const s = d.style
    return s.borderRadius === '8px' && s.background && s.background !== 'transparent' && s.position === 'absolute' && s.width && parseInt(s.width) > 300
  }).map((d) => {
    const r = d.getBoundingClientRect()
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) }
  })
  return { blockCount: blockInfo.length, blockInfo, pageCount: pages.length, pages }
})

console.log('PAGE_COUNT:', data.pageCount)
console.log('PAGES:', JSON.stringify(data.pages))
// 找出落在所有纸页矩形之外（间隙）的块
const inAnyPage = (t, b) => data.pages.some((p) => t >= p.top - 1 && b <= p.bottom + 1)
const outside = data.blockInfo.filter((b) => !inAnyPage(b.top, b.bottom))
console.log('BLOCKS_OUTSIDE_PAGES:', outside.length)
outside.slice(0, 8).forEach((b) => console.log('  OUTSIDE:', JSON.stringify(b)))
console.log('ERRORS:', errors.slice(0, 6))
await browser.close()
