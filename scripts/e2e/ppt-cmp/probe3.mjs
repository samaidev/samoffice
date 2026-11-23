// round58 探针 v3：正确切换页面后检查 bullet/装饰/标题
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
for (const idx of [8, 0]) {
  const ok = await p.evaluate((i) => {
    const list = document.querySelector('.w-40, .w-48')
    if (!list) return false
    const cards = list.querySelectorAll('.space-y-2 > div')
    if (cards[i]) { cards[i].dispatchEvent(new MouseEvent('click', { bubbles: true })); return true }
    return false
  }, idx)
  await p.waitForTimeout(800)
  const r = await p.evaluate(() => {
    const cv = document.querySelector('.slide-canvas')
    if (!cv) return { err: 'no canvas' }
    const bulletSpans = Array.from(cv.querySelectorAll('span')).filter(x => (x.textContent || '') === '•' || /^第?[0-9一二三]+[.、]?$/u.test((x.textContent || '').trim())).length
    const first = Array.from(cv.querySelectorAll('span')).find(x => /教育背景|第一，/.test(x.textContent || ''))
    const para = first ? first.parentElement : null
    const bulletSpan = para ? (para.previousElementSibling || (para.parentElement && para.parentElement.firstElementChild)) : null
    return {
      canvasText: (cv.textContent || '').slice(0, 80),
      bullets: bulletSpans,
      bulletSample: bulletSpan ? { text: bulletSpan.textContent, color: getComputedStyle(bulletSpan).color } : null,
      bodyColor: first ? getComputedStyle(first).color : null,
      bodySize: first ? getComputedStyle(first).fontSize : null,
      paraHtml: para ? para.outerHTML.slice(0, 220) : null,
    }
  })
  console.log(`slide${idx + 1}:`, JSON.stringify(r))
}
await b.close()
