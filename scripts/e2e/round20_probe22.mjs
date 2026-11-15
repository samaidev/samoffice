// 视口全部正常。最后且唯一的可能：**有一个透明元素盖在下半屏**，它 pointer-events:auto
// 但 elementsFromPoint 没显示？不可能。或者它是【.pg-paper 纸页层的 footer 层】
// pe=auto 占满下半 —— footer 层 top = bodyTop+p.top+p.height-... 若分页 rects 错乱，
// footer 可能盖在表格上。pg-paper 层 zIndex:0 + PM 层 zIndex 谁高？
// 直接查 PM 层和纸页层的层叠顺序 + (700,530) 处所有兄弟层矩形：
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
const res = await p.evaluate(() => {
  // 编辑器滚动容器内的直接子层结构
  const sc = document.querySelector('.flex-1.overflow-auto')
  const kids = Array.from(sc.children).map(c => {
    const s = getComputedStyle(c)
    const r = c.getBoundingClientRect()
    return `${c.tagName}.${(c.className?.toString().slice(0, 25) || '')} z=${s.zIndex} pe=${s.pointerEvents} y=${Math.round(r.y)} h=${Math.round(r.height)}`
  })
  // 所有 pe=auto 且覆盖 (700,530) 的元素（遍历全部元素太慢——只查 sc 子孙中
  // position absolute/relative 且盖住该点的 pe!=none 元素）
  const covers = []
  sc.querySelectorAll('*').forEach(el => {
    const s = getComputedStyle(el)
    if (s.pointerEvents === 'none') return
    const r = el.getBoundingClientRect()
    if (r.width < 50 || r.height < 20) return
    if (700 >= r.x && 700 <= r.x + r.width && 530 >= r.y && 530 <= r.y + r.height) {
      if (s.zIndex !== 'auto' || s.position === 'fixed' || s.position === 'sticky') {
        covers.push(`${el.tagName}.${(el.className?.toString().slice(0, 25) || '')} z=${s.zIndex} pos=${s.position}`)
      }
    }
  })
  return { kids, covers: covers.slice(0, 10) }
})
console.log('滚动容器子层:', JSON.stringify(res.kids, null, 1))
console.log('(700,530) 上的 z 层:', JSON.stringify(res.covers))
await b.close()
