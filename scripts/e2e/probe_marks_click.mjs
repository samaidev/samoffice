// probe_marks_click.mjs — 验证 ¶ 按钮点击是否真的切换 showMarks
import { chromium } from 'playwright'

const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
await p.goto('http://localhost:18400', { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
await p.evaluate(() => { localStorage.setItem('samoffice_lang', 'zh'); localStorage.setItem('samoffice_show_marks', '0') })
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
await p.locator('[data-testid="menu-files"]').click(); await p.waitForTimeout(400)
await p.locator('text=📝').first().click(); await p.waitForTimeout(1000)
await p.evaluate(() => {
  const para = (txt) => ({ type: 'paragraph', inline: [{ content: txt }] })
  window.__setDocForTest({ meta: { title: 't' }, blocks: [para('甲'), { type: 'pageBreak', restart: false, startNumber: 1 }, para('乙')] })
})
await p.waitForTimeout(1200)

const state = async (tag) => {
  const s = await p.evaluate(() => {
    const ls = localStorage.getItem('samoffice_show_marks')
    const btns = Array.from(document.querySelectorAll('button')).filter(x => (x.textContent || '').trim().startsWith('¶'))
    return {
      ls,
      btnCount: btns.length,
      btnActive: btns.map(x => x.className.includes('active')),
      anyShowEdit: !!document.querySelector('.show-edit-marks'),
      labelDisplay: (() => { const l = document.querySelector('.page-break-label'); return l ? getComputedStyle(l).display : 'no-label' })(),
    }
  })
  console.log(tag, JSON.stringify(s))
  return s
}
await state('初始:')
const btn = p.locator('button').filter({ hasText: /^¶/ }).first()
const box = await btn.boundingBox()
console.log('按钮位置:', JSON.stringify(box))
await btn.click(); await p.waitForTimeout(600)
await state('点击后:')
await p.evaluate(() => console.log('console-check'))
await b.close()
