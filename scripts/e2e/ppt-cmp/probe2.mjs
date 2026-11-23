// round58 探针：画布背景图层 / 逐段项目符号 / 每页装饰
import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
p.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 150)))
await p.goto('http://localhost:18400', { waitUntil: 'networkidle' })
await p.waitForTimeout(800)
await p.evaluate(() => { localStorage.setItem('samoffice_lang', 'zh') })
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(1000)
await p.locator('[data-testid="menu-files"]').click({ force: true }); await p.waitForTimeout(400)
const [ch] = await Promise.all([p.waitForEvent('filechooser', { timeout: 10000 }), (async () => { await p.locator('text=📂').first().click({ force: true }) })()])
await ch.setFiles('/home/z/my-project/upload/装备工业的互联网 机遇.pptx')
await p.waitForTimeout(4000)
const probe = async (idx) => {
  await p.evaluate((i) => {
    const list = document.querySelector('.w-40, .w-48')
    const cards = list?.querySelectorAll('.space-y-2 > div')
    cards?.[i]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  }, idx)
  await p.waitForTimeout(700)
  return await p.evaluate(() => {
    const cv = document.querySelector('.slide-canvas')
    if (!cv) return null
    const bgLayer = cv.querySelector(':scope > div[style*="background-image"]')
    const bulletSpans = Array.from(cv.querySelectorAll('span')).filter(x => (x.textContent || '') === '•' || /^[0-9]+\.$/.test(x.textContent || '')).length
    // 装饰层（zIndex 15 容器）里的形状
    const decoLayer = cv.querySelector(':scope > div[style*="z-index: 15"]')
    const decoShapes = decoLayer ? decoLayer.children.length : -1
    const titleSpan = Array.from(cv.querySelectorAll('span')).find(x => /互联网\+机遇|个人简介/.test(x.textContent || ''))
    return {
      bgImg: !!bgLayer, blend: bgLayer ? getComputedStyle(bgLayer).mixBlendMode || getComputedStyle(bgLayer).backgroundBlendMode : null, size: bgLayer ? getComputedStyle(bgLayer).backgroundSize : null,
      bullets: bulletSpans, decoShapes,
      titleColor: titleSpan ? getComputedStyle(titleSpan).color : null,
      titleSize: titleSpan ? getComputedStyle(titleSpan).fontSize : null,
    }
  })
}
const dbg = await p.evaluate(() => {
  const cv = document.querySelector('.slide-canvas')
  // 找包含"教育背景"或"第一"的形状内容层，打前 300 字 HTML
  const els = Array.from((cv || document).querySelectorAll('span'))
  const hit = els.find(x => /教育背景|第一/.test(x.textContent || ''))
  const shapeDiv = hit ? hit.closest('div.absolute') : null
  return { found: !!hit, html: shapeDiv ? shapeDiv.innerHTML.slice(0, 500) : (cv ? cv.innerHTML.slice(0, 300) : '') }
})
console.log('dbg:', JSON.stringify(dbg).slice(0, 700))
await b.close()
