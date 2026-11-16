// 克隆被 PM DOMObserver 清掉了（stillThere:false）—— 所以 probe39 的
// "流内 clone DEAD" 结果无效（点击时克隆已不存在）！
// 同理 probe21 的 fixed 克隆 target=HTML 也是因为克隆被移除后点击落空！
// ★ 全部克隆实验作废。铁证只剩：
// 1) PM 内的【表格】死 2) PM 内的段落活 3) about:blank 相同表格活
// → 差异是 PM 管理的表格 NodeView。DocTableView！
// PM NodeView 的 dom 由 PM 拥有。表格 wrapper 上有没有 PM 挂的
// 「ignoreMutation/stopEvent」？ —— stopEvent 只影响 PM 内部处理，
// 不吞原生事件。
// 等等！！还有一个从未检查的：**Ruler.tsx**（标尺）！show-ruler 类下
// .sam-ruler 是 fixed/absolute 顶部横条。还有 print preview？不。
// ★ 直接对照法：在应用页面里用 CSS 隐藏【表格】并显示一个普通 div 在
// 原位置（z-index 最高）→ 可点否？可点 → 表格元素本身在应用页面的层环境下死。
// （之前 cover-table 实验证明外来 fixed 表格可点 —— 但那是在 body！）
// 现在把外来表格放进 pm-host（非 PM dom，PM 不会清除）：
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
const box = await p.evaluate(() => {
  const host = window.__pmView.dom.parentElement // pm-host —— React 拥有，PM 不清
  const td = [...document.querySelectorAll('.ProseMirror td')][2]
  const r = td.getBoundingClientRect()
  const t = document.createElement('table')
  t.style.cssText = `position:fixed;left:${r.x}px;top:${r.y}px;width:${r.width}px;height:${r.height}px;z-index:2147483647;background:#fffde7`
  t.innerHTML = '<tr><td>HOST-TD</td></tr>'
  host.appendChild(t)
  window.__e = []
  window.addEventListener('pointerdown', e => window.__e.push(e.target.tagName), { capture: true, passive: true })
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(200)
console.log('pm-host fixed table →', JSON.stringify(await p.evaluate(() => window.__e)))
await b.close()
