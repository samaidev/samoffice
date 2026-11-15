// 滚轮路径也 MISS！（tdTop=357 仍死区）—— 推翻"程序化滚动才死"的假设。
// 但【未滚动时 y=820 HIT】依然成立。那就是【滚动行为本身】让 compositor
// 的 hit-test 层失效（无论怎么滚）。真实用户也会滚！这是真 bug！
// 
// 深挖 compositor 层：滚动后 body 是否有 will-change/层提升导致 stale？
// 检查 scroller 的 CSS（contain? content-visibility? overflow-anchor:none!）
// overflow-anchor:none 在 pageRef 上有 —— 但那影响滚动锚定。
// content-visibility: auto 会让屏外内容不渲染 —— 滚动后 hit-test 区域未更新！
// 搜 CSS：
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const b = await chromium.launch({ args: ['--no-sandbox'], headless: false })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(20000)
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
const info = await p.evaluate(() => {
  // 找 scroller 到 td 之间所有带 contain / content-visibility / will-change 的元素
  const td = document.querySelector('.ProseMirror table td')
  const out = []
  let n = td
  while (n && n !== document.body) {
    const s = getComputedStyle(n)
    if (s.contain !== 'none' || s.contentVisibility !== 'visible' || s.willChange !== 'auto') {
      out.push(`${n.tagName}.${(n.className?.toString().slice(0, 20) || '')} contain=${s.contain} cv=${s.contentVisibility} wc=${s.willChange}`)
    }
    n = n.parentElement
  }
  // scroller 自身
  const sc = document.querySelector('.flex-1.overflow-auto')
  const ss = getComputedStyle(sc)
  out.push(`SCROLLER contain=${ss.contain} cv=${ss.contentVisibility} wc=${ss.willChange} oa=${ss.overflowAnchor}`)
  return out
})
console.log(JSON.stringify(info, null, 1))
await b.close()
