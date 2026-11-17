// td[8] 点击：光标进格 ✓ 但页面从 9658 跳到 16142（+6484，约两页）。
// 16142 处是哪？—— 光标 5174 的实际 DOM 位置（分页布局：内容被分页
// 拆到第 N 页 —— pos 5174 的 td[8] 渲染在 scrollTop 16142 的页面）。
// ★ 等等 —— td[8] 的 rect 在视口内（vis:true，y<870）才点的 —— 
// 点击时 td[8] 在 9658 滚动位置可见！但 PM 滚到了 16142 —— 
// 【posToDOM 与可视 DOM 脱节】：分页插件把表格复制/装饰成多页时，
// PM 的 domAtPos 找到的是【另一个页面的同名节点】？或 5174 的
// posToDOM 节点在文档更下方的分页区。
// ★★★ 这就是用户「页面位置移动，根本无法定位编辑」的确切根源！
// 修法：applySel 补刀后禁用 PM 的 scrollIntoView —— PM 端 focus 不滚
//（focus 本身不滚动）—— 滚动来自哪里？v.dispatch(tr.setSelection(...))
// 不带 scrollIntoView —— 但 PM 的 updateState 内部会调用 scrollIntoView
//（EditorView.update 对 selection 变化默认滚动到光标 —— 
// prosemirror-view 的 scrollAncestors/scrollToSelection）。
// 验证：dispatch 后 scrollTop 变化时机 + 若我们 dispatch 前把
// selection 设为同值（无变化）是否还滚：
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 150)))
p.setDefaultTimeout(30000)
await p.goto(BASE + '/?r=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
const buf = fs.readFileSync(DOC)
const form = new FormData()
form.append('file', new Blob([buf]), 'contract.docx')
const r = await fetch(BASE + '/api/doc/open', { method: 'POST', body: form })
const j = await r.json()
await p.evaluate(d => window.__setDocForTest(d), j.document)
await p.waitForTimeout(5000)
await p.evaluate(() => { document.querySelector('.ProseMirror table').scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(1500)
// 纯 evaluate 设 selection 到 5174（td[8]）看是否触发滚动
const st = await p.evaluate(() => {
  const v = window.__pmView
  const top0 = document.querySelector('.overflow-auto').scrollTop
  const tr = v.state.tr.setSelection(v.state.selection.constructor.near(v.state.doc.resolve(5174), 1))
  // 带 scrollIntoView 的标记检查：tr.scrolledIntoView 由 scrollIntoView() 设置
  v.dispatch(tr)
  const top1 = document.querySelector('.overflow-auto').scrollTop
  return { top0, top1, deltaNoScroll: top1 - top0 }
})
console.log('evaluate dispatch（无显式 scrollIntoView）:', JSON.stringify(st))
await b.close()
