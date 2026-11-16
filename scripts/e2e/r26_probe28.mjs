// user-select 无异常。回到已铁证的事实：触摸活、鼠标死、克隆到 body 活、
// 在 PM 内 fixed 死。这组合指向一个 Chromium 特性：**"mouse event capture
// by TableSelection" 不存在** —— 但「Scroll anchoring / overscroll」也不吞事件。
// ★ 剩最后一个真实可能：CSS **`contain`** 或 **`content-visibility`**。
// 之前 diff 只查了部分属性。全量对比 TD 的祖先 vs P 的祖先中「第一个不同的层」。
// 其实 P 与 TD 的共同祖先是 ProseMirror！P 无额外中间层。
// 也就是说差异 = [tableWrapper, TABLE, TBODY, TR, TD] vs 直接 P。
// 克隆（带这些层）放 body 可点 → 层本身无罪 → 位置+层组合问题。
// 坐标相关 + 鼠标管线专属 = 合成器 tiles!  ✓✓✓ 
// **表格位于内容流 y≈9742，恰好超过某个 tile 边界（如 8192）** ——
// Chromium 瓦片化渲染对「跨 tile 的表格合成层」hit-test 失效！
// 段落 9725 也>8192 却活…… 不对。
// 验证 tile 理论：滚动一点点（scrollTop 9441→9440），表格视觉位置 +1px，
// 若死区边界跟着内容移动而非固定屏幕线 → 与内容流位置无关（推翻 tile）；
// 若死区边界固定在屏幕某 y → 屏幕空间问题。
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
await p.waitForTimeout(1000)
const x = await p.evaluate(() => {
  window.__scan = []
  window.addEventListener('pointerdown', e => window.__scan.push(Math.round(e.clientY)), { capture: true, passive: true })
  const rr = [...document.querySelectorAll('.ProseMirror td')][2].getBoundingClientRect()
  return Math.round(rr.x + rr.width / 2)
})
const runScan = async () => {
  await p.evaluate(() => { window.__scan = [] })
  const boundary = await p.evaluate((x) => {
    // 返回表格顶部视觉 y
    return Math.round([...document.querySelectorAll('.ProseMirror td')][0].getBoundingClientRect().top)
  }, x)
  return boundary
}
// A: 当前 scrollTop（9441）扫描
let t0 = await runScan()
for (let y = t0 - 12; y <= t0 + 12; y += 4) { await p.mouse.click(x, y); await p.waitForTimeout(50) }
const a = await p.evaluate(() => window.__scan)
console.log(`tableTop=${t0}: live y =`, JSON.stringify(a))
// B: scrollTop -50（表格上移 50px）
await p.evaluate(() => { document.querySelector('.flex-1.overflow-auto').scrollTop -= 50 })
await p.waitForTimeout(500)
t0 = await runScan()
for (let y = t0 - 12; y <= t0 + 12; y += 4) { await p.mouse.click(x, y); await p.waitForTimeout(50) }
const bb = await p.evaluate(() => window.__scan)
console.log(`after scroll-50 tableTop=${t0}: live y =`, JSON.stringify(bb))
await b.close()
