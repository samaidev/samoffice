// sameAsTargetTd=false！(700,530) 命中的 SPAN 在另一个格（文档里多处表格）。
// hitY=528 与目标 tdTop=515 不同格但都在 530 附近 —— 说明【第一个 .ProseMirror table td
// 查询到的 td】与视口内实际显示的不是同一个！
// 但都不重要了 —— 关键事实：视口内 y>500 区域的表格 SPAN 全部点击无效。
// 而 clippedBy=null 说明 hit 元素链上没有 overflow 裁剪（它没有被裁）。
// 那事件为什么丢？—— 最后一层：视觉视口 vs layout 视口。headless 的
// window.visualViewport？
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
const vv = await p.evaluate(() => {
  const v = window.visualViewport
  return {
    innerH: window.innerHeight, innerW: window.innerWidth,
    vvH: v ? Math.round(v.height) : null, vvW: v ? Math.round(v.width) : null,
    vvScale: v ? v.scale : null, vvOffsetTop: v ? Math.round(v.offsetTop) : null,
    outerH: window.outerHeight,
    screenH: window.screen?.height,
  }
})
console.log(JSON.stringify(vv))
await b.close()
