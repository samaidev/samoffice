// pm 容器 y=-9203 h=16842 且有 transform:matrix —— 这是 zoom 缩放层。
// 纸页层 zIndex:0 + pointerEvents:none（无害）。但表格在 zoom transform 容器里，
// 而纸页层与 PM 平级。死区边界 495-525 与表格顶 515 吻合 —— 表格区域被
// 【页脚层/角标层】盖住？角标 pointerEvents:none，页脚 pe=auto 但只在页底。
// 直觉错误方向。换测法：用真实浏览器事件（不用 playwright 合成）：在页面里
// 程序化 elementFromPoint 已验证 —— 改用【真实 hit-test】：node.getRootNode?
// 都一样。
// 换个角度彻底绕过：直接检查 zoom 层 —— transform:matrix(...) 的矩阵值：
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
const m = await p.evaluate(() => {
  // 找带 transform 的祖先，输出完整矩阵和 zoom
  const pm = document.querySelector('.ProseMirror')
  let n = pm.parentElement
  const out = []
  while (n && n !== document.body) {
    const s = getComputedStyle(n)
    if (s.transform !== 'none') {
      const r = n.getBoundingClientRect()
      out.push({ tag: n.tagName, cls: (n.className?.toString().slice(0, 20) || ''), matrix: s.transform, rect: { y: Math.round(r.y), h: Math.round(r.height), bottom: Math.round(r.bottom) }, clip: s.overflow, zoomAttr: n.style.zoom || '' })
    }
    n = n.parentElement
  }
  // 页脚层是否覆盖表格
  const footers = document.querySelectorAll('[title]')
  return { transforms: out, __docZoom: window.__docZoom }
})
console.log(JSON.stringify(m, null, 1).slice(0, 900))
await b.close()
