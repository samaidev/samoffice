// 边界在 495-525 之间（表格顶=515）。死区 = 表格内部！
// y=525 起无事件 —— 表格区域【本身】吞掉鼠标。而 elementFromPoint 说命中 SPAN。
// 矛盾的最终解释：SPAN 是 PG 分页装饰生成的【装饰层】副本，真实可交互 td 被
// 装饰覆盖，装饰层有 pointer-events 但吞事件（比如装饰 span 在 .pg-paper 装饰里，
// 分页引擎给纸页层设置了不可交互，但没设到内层 span）。
// 看 (700, 525) 命中链 vs (700, 495) 命中链对比：
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(15000)
await p.goto('http://localhost:18400', { waitUntil: 'networkidle' })
await p.evaluate(() => localStorage.setItem('samoffice_theme', 'light'))
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
const buf = fs.readFileSync(DOC)
const form = new FormData()
form.append('file', new Blob([buf]), 'contract.docx')
const r = await fetch('http://localhost:18400/api/doc/open', { method: 'POST', body: form })
const j = await r.json()
await p.evaluate(d => window.__setDocForTest(d), j.document)
await p.waitForTimeout(2500)
await p.evaluate(() => {
  const sc = document.querySelector('.flex-1.overflow-auto')
  const td = document.querySelector('.ProseMirror table td')
  const scRect = sc.getBoundingClientRect()
  const tdTop = td.getBoundingClientRect().top
  sc.scrollTop += tdTop - scRect.top - 300
})
await p.waitForTimeout(2000)
const cmp = await p.evaluate(() => {
  const dump = (x, y) => {
    const els = document.elementsFromPoint(x, y)
    return els.slice(0, 6).map(e => {
      const s = getComputedStyle(e)
      return `${e.tagName}.${(e.className?.toString().slice(0, 20) || '')}|pe=${s.pointerEvents}`
    })
  }
  return { above: dump(700, 490), inside: dump(700, 530) }
})
console.log('表格上方 (700,490):', JSON.stringify(cmp.above, null, 1))
console.log('表格内部 (700,530):', JSON.stringify(cmp.inside, null, 1))
await b.close()
