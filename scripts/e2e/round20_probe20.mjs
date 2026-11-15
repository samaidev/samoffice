// transform 是 identity（无缩放），clip=visible。y=-9203..7639 覆盖视口。
// 【clip: visible 的祖先 + overflow auto 容器】：PM 内容超出滚动容器
// (scroller y=215..870) —— 视觉上内容被 scroller 裁剪，但 hit-test
// （elementsFromPoint）不裁剪 overflow:visible 的子层！
// 也就是说 (700, 530) 命中的 SPAN【其实是文档深处（y=530+9203 的另一个表格格）
// 的元素】，不是视口内那个！而浏览器的事件派发用真实几何（裁剪后的）—— 
// 真实该位置是【页脚/空白/纸页边缘】等不可点区，事件被丢弃。
// 验证：比较命中 SPAN 的 getBoundingClientRect().top 是否 ≈530
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
  // 目标 td 与 视觉位置
  const td = document.querySelector('.ProseMirror table td')
  const r1 = td.getBoundingClientRect()
  // (700,530) 命中的元素真实位置
  const hit = document.elementFromPoint(700, 530)
  const hr = hit.getBoundingClientRect()
  // scroller 的可交互判定：真实命中链上是否有任何祖先 clip 掚除
  let clipped = null
  let n = hit
  while (n && n !== document.body) {
    const s = getComputedStyle(n)
    if (s.overflow !== 'visible') {
      const rr = n.getBoundingClientRect()
      // 若 hit 元素在 overflow 容器的裁剪区外 → 它实际不可见/不可交互
      if (hr.bottom <= rr.top || hr.top >= rr.bottom) { clipped = n.tagName + '.' + (n.className?.toString().slice(0, 20)); break }
    }
    n = n.parentElement
  }
  return {
    tdTop: Math.round(r1.top),
    hitTag: hit.tagName, hitY: Math.round(hr.y),
    sameAsTargetTd: hit.closest('td') === td,
    clippedBy: clipped,
  }
})
console.log(JSON.stringify(res, null, 1))
await b.close()
