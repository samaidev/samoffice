// 决定性线索！！这次 cell.top=9957（【没滚动成功】），点击 y=9983（视口外！）
// —— Playwright 对视口外的点击会先自动滚动元素进入视口再点击，事件正常发出
// （都在 9983 附近，滚动了滚动容器）→ 事件到达 ✓。
// 而之前【scrollIntoView 后 top≈300】的试验里点击 (315,325) 无事件 ——
// 因为那时真实坐标系的表格其实在 9957！scrollIntoView({block:center}) 滚的是
// 【某个容器】，getBoundingClientRect 显示 top=299 —— 但 Playwright mouse 派发时
// 用的坐标与页面坐标系不匹配？？
// 不 —— 更可能：scrollIntoView 滚动了【外层窗口滚动】（window.scrollTo），而
// Playwright viewport 内 mouse 事件确实发到了 (315,325)……而那里【真实元素】
// 是别的（比如分页纸页背景层）。elementFromPoint(315,325)=SPAN 是 scrollIntoView
// 之后查询的 —— 应该一致……
// 唯一没验证的：那个 SPAN 是不是【表格里那个 SPAN】。一次性把整条链查清：
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

// 手动滚内层容器到表格（不用 scrollIntoView，避免它滚外层）
await p.evaluate(() => {
  const sc = document.querySelector('.flex-1.overflow-auto')
  const td = document.querySelector('.ProseMirror table td')
  const scRect = sc.getBoundingClientRect()
  const tdTop = td.getBoundingClientRect().top
  sc.scrollTop += tdTop - scRect.top - 300  // 让表格到视口 y≈300
})
await p.waitForTimeout(3000)
const info = await p.evaluate(() => {
  const td = document.querySelector('.ProseMirror table td')
  const r1 = td.getBoundingClientRect()
  const hit = document.elementFromPoint(r1.x + r1.width / 2, r1.y + r1.height / 2)
  return {
    tdTop: Math.round(r1.top),
    hitTag: hit?.tagName,
    hitInTd: !!hit?.closest('td'),
    windowScrollY: Math.round(window.scrollY),
    bodyScrollTop: document.body.scrollTop,
    docElScrollTop: document.documentElement.scrollTop,
  }
})
console.log('手动滚动后:', JSON.stringify(info))
const box = await p.evaluate(() => {
  const r1 = document.querySelector('.ProseMirror table td').getBoundingClientRect()
  return { x: r1.x + r1.width / 2, y: r1.y + r1.height / 2 }
})
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(400)
const st = await p.evaluate(() => ({ focused: window.__pmView.hasFocus(), from: window.__pmView.state.selection.from }))
console.log('点击后:', JSON.stringify(st), st.focused ? 'FOCUS-OK!' : 'still no focus')
await b.close()
