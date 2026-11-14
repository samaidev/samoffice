// round20: 表格单元格点击后 PM 失焦排查 —— 精简版（无 arguments 陷阱）
import { chromium } from 'playwright'

const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'

async function main() {
  const browser = await chromium.launch({ args: ['--no-sandbox'] })
  const page = await (await browser.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
  page.setDefaultTimeout(20000)
  await page.goto('http://localhost:18400', { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.setItem('samoffice_theme', 'light'))
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)

  const fs = await import('fs')
  const buf = fs.readFileSync(DOC)
  const form = new FormData()
  form.append('file', new Blob([buf]), 'contract.docx')
  const r = await fetch('http://localhost:18400/api/doc/open', { method: 'POST', body: form })
  const j = await r.json()
  await page.evaluate(d => window.__setDocForTest(d), j.document)
  await page.waitForTimeout(2500)

  const probe1 = await page.evaluate(() => {
    const pm = window.__pmView
    return {
      editable: pm ? pm.editable : null,
      contentEditableAttr: pm?.dom?.getAttribute('contenteditable'),
      focusedBefore: pm?.hasFocus(),
    }
  })
  console.log('点击前:', JSON.stringify(probe1))

  const cell = await page.$('.ProseMirror table td p')
  await cell.scrollIntoViewIfNeeded()
  await page.waitForTimeout(500)
  const box = await cell.boundingBox()
  await page.mouse.click(box.x + 10, box.y + box.height / 2)
  await page.waitForTimeout(300)

  const probe2 = await page.evaluate(() => {
    const pm = window.__pmView
    const ae = document.activeElement
    return {
      focusedAfter: pm.hasFocus(),
      activeEl: ae ? ae.tagName + '.' + (ae.className || '').toString().slice(0, 30) : 'none',
      contentEditableAttr: pm.dom.getAttribute('contenteditable'),
      editableProp: pm.editable,
      // 点击处 posAtCoords 映射
      posAt: (() => {
        try {
          const res = pm.posAtCoords({ left: window.__lastClickX || 0, top: window.__lastClickY || 0 })
          return res ? res.pos : null
        } catch { return 'err' }
      })(),
    }
  })
  console.log('点击后:', JSON.stringify(probe2))

  // 对比：点击正文段落（非表格）是否 focus
  const para = await page.$('.ProseMirror p')
  await para.scrollIntoViewIfNeeded()
  await page.waitForTimeout(400)
  const pbox = await para.boundingBox()
  await page.mouse.click(pbox.x + 10, pbox.y + pbox.height / 2)
  await page.waitForTimeout(300)
  const probe3 = await page.evaluate(() => ({ focusedParaClick: window.__pmView.hasFocus() }))
  console.log('点击正文段落后:', JSON.stringify(probe3))

  await browser.close()
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1) })
