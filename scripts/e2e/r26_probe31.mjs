// 缩放层 transform 本来就是空（zoom=100 时不写 transform）。
// 那问题不在 transform。回到「触摸活鼠标死」+「wrapper 区域死」：
// 这模式匹配 Chromium 的 **CSS touch-action / overscroll-behavior**？
// 不吞 mousedown。匹配 **"mouse event hit-testing on fractional scroll
// offset"**：scrollTop=9441 是整数。但表格 top=516.40625 —— 小数！
// 段落 y 也是小数。
// ★ 冷静盘点所有实验，唯一没试的重大嫌疑：**column-count**！
// pm-host 有 columnCount: docColumns>1 —— 此文档也许 docColumns=2/3！
// probe 之前查过 editorColumns=auto —— 那查的是 .ProseMirror 的 parent
// 的 columnCount（= pm-host?）—— 得到 auto。但也许 pm-host 有
// 【column-span:all 的子元素】或 CSS columns 在别处。
// 彻底列出 PM dom 到 body 间所有祖先的 columnCount/columnWidth：
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(800)
const buf = fs.readFileSync(DOC)
const form = new FormData()
form.append('file', new Blob([buf]), 'contract.docx')
const r = await fetch(BASE + '/api/doc/open', { method: 'POST', body: form })
const j = await r.json()
await p.evaluate(d => window.__setDocForTest(d), j.document)
await p.waitForTimeout(3500)
await p.evaluate(() => { [...document.querySelectorAll('.ProseMirror td')][2].scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(1200)
const info = await p.evaluate(() => {
  const out = []
  let el = [...document.querySelectorAll('.ProseMirror td')][2].closest('table')
  while (el && el !== document.documentElement) {
    const s = getComputedStyle(el)
    out.push({
      el: el.tagName + '.' + (el.className || '').toString().trim().slice(0, 16),
      colCount: s.columnCount, colWidth: s.columnWidth, colGap: s.columnGap,
      writingMode: s.writingMode, direction: s.direction,
      flexFlow: s.flexFlow, display: s.display,
    })
    el = el.parentElement
  }
  return out
})
console.log(JSON.stringify(info, null, 1))
await b.close()
