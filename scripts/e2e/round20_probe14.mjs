// 页面完全静止，无滚动无突变。但 y>550 点击无效。
// 再想 —— probe10 死区测试时视口有表格（tdTop≈300 旧坐标）？不 —— probe10 的
// scroll 后 tdTop 是多少没记录。而 probe9 手动滚到 tdTop=515 —— 那次点击
// (315,528) 也失败。
// 但早期 round20_focus_probe（初次复现）时同样失败的是 box.y+13≈542……
// 而 probe3 点击【正文段落】成功 —— para top=335！哦！！所有成功的点击都在
// y < 550，所有失败的都在 y >= 542。死区边界 ≈540-550。
// 疯狂假设：视口实际高度不是 900？innerHeight=900（probe5 里 vh:900 ✓）。
// 那 550 边界是什么？—— .flex-1.overflow-auto 容器的【clientHeight】！
// 工具栏占 100px + ribbon 占 200px + …… 编辑器可视高度可能只有 ~540px，
// 之下是【另一个面板】（批注栏/脚注栏？）。elementsFromPoint(700,700) 显示的
// 却是 SPAN in ProseMirror —— 如果 ProseMirror 容器高 900 但其父 overflow 容器
// 只显示到 540，那 700 处的 SPAN 其实被【裁剪不可见】（clip）！elementsFromPoint
// 不受 overflow clip 影响？其实受 —— 但父容器若没 overflow:hidden 而是 auto，
// SPAN 在滚动区外仍可被命中（浏览器 bug 行为不一致）。
// 直接验证：.flex-1.overflow-auto 的几何 + (700,700) 相对它的位置
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
const geo = await p.evaluate(() => {
  const sc = document.querySelector('.flex-1.overflow-auto')
  const r = sc.getBoundingClientRect()
  const pm = document.querySelector('.ProseMirror')
  const pr = pm.getBoundingClientRect()
  // 找所有 overflow 裁剪链上的祖先
  const chain = []
  let n = pm.parentElement
  while (n && n !== document.body) {
    const s = getComputedStyle(n)
    if (s.overflow !== 'visible' || s.position === 'fixed' || s.position === 'sticky') {
      const rr = n.getBoundingClientRect()
      chain.push({ tag: n.tagName, cls: (n.className?.toString().slice(0, 25) || ''), ov: s.overflow, y: Math.round(rr.y), h: Math.round(rr.height), bottom: Math.round(rr.bottom) })
    }
    n = n.parentElement
  }
  return { scroller: { y: Math.round(r.y), h: Math.round(r.height), bottom: Math.round(r.bottom), ch: sc.clientHeight, sh: sc.scrollHeight }, pmRect: { y: Math.round(pr.y), h: Math.round(pr.height) }, clipChain: chain }
})
console.log(JSON.stringify(geo, null, 1).slice(0, 1300))
await b.close()
