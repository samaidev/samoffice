// 等一下——probe19 的结论需要复核：fixed wrapper 放进 mx-auto OK，
// 但放 ProseMirror 里 DEAD。而【最初的 reparent 实验（probe6）】里
// 挂到 overflow-auto（更高的祖先）也有事件。两个实验有矛盾？
// probe6 reparent 的是 wrapper（无 fixed），事件恢复在 [7] overflow-auto；
// probe19 fixed wrapper 在 chain[5] mx-auto 就恢复。
// 共同点：**只要不在 ProseMirror 树内，事件就正常**。
// 段落可点（在 PM 内）vs 表格不可点（在 PM 内）→ PM 内表格特有！
// ProseMirror 对 table 有 TableEditing/CellSelection 逻辑：
// mousedown 在 td 上 → PM stopEvent? 查 PM 版本的 tables 插件源码行为 ——
// 但段落有事件、表格没有 —— 说明「事件没进 window」发生在更底层。
// ★★ 顿悟候选：表格区有 CSS `.pg-brk-table { margin-bottom }` + 
// `border-collapse: separate` 的规则 —— 而 **wrapper 高度 487 但渲染时
// table 的高度只有 487** …… 都正常。
// 换终极二分：**克隆 PM 表格（含所有类名/内联样式）放进 PM dom 的段落旁边**，
// 保留 PM 环境。可点 → PM 对"那个位置"的表格才有问题（位置相关）；
// 不可点 → PM dom 内任何表格都死（环境相关）。
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
const res = await p.evaluate(() => {
  const pm = window.__pmView.dom
  const td = [...document.querySelectorAll('.ProseMirror td')][2]
  const table = td.closest('table')
  const wrapper = table.closest('.tableWrapper')
  // 深克隆
  const clone = wrapper.cloneNode(true)
  // fixed 盖在原表格位置（clone 留在 PM 内！）
  const r = wrapper.getBoundingClientRect()
  clone.style.cssText = `position:fixed;left:${r.x}px;top:${r.y}px;width:${r.width}px;z-index:99999;background:#fffde7;margin:0`
  pm.appendChild(clone) // ← 放进 PM dom
  window.__ev = []
  window.addEventListener('pointerdown', e => window.__ev.push(e.target.tagName), true)
  const rr = clone.getBoundingClientRect()
  return { x: rr.x + rr.width / 2, y: rr.y + rr.height / 2, inPM: pm.contains(clone) }
})
console.log('clone in PM:', res.inPM)
await p.mouse.click(res.x, res.y)
await p.waitForTimeout(250)
console.log('events:', JSON.stringify(await p.evaluate(() => window.__ev)))
await b.close()
