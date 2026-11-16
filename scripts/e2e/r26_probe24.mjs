// 几何全正常。但合成器把 wrapper 区域(516~1003)+其后都视为落空。
// 段落(499)活、表格(516)死 —— 边界就在 500~516 之间。
// ★ 已知 Chromium 真实 bug 模式：**巨大 contenteditable + 表格 + 
// Multi-column/分页 margin** 下的 compositor layer "out of bounds"。
// 但真正测试过的事实链：
// 1) 同样 DOM 结构（克隆）放 body 可点
// 2) 放 PM dom 内 fixed 不可点（HTML 落空）
// 3) 段落在 PM dom 内可点
// 差异仅在「表格子树」—— PM 的 TableEditing 插件在 mousedown 时
// preventDefault？不对，事件根本没到。
// ★★ 最后嫌疑：**pm-host 的 columnCount 或 pm 上的 white-space/contain**。
// 直接 dump PM dom 的 computedStyle 全量 vs 段落处 body 用的容器。
// 不，换更快路径：**检查 PM dom 是不是有 layer bounds 限制 —— 
// PM 高 16638px，合成器层的 max texture size 通常是 4096/8192！
// 表格位置 9622~10109（内容流），而段落 499 的内容流位置是 ~9439+499-215?? 
// 算：scrollTop=9441, TD 视口 y=516 → 内容流位置 = 9441+516-215(editorScroll top) = 9742
// 段落 y=499 → 内容流 = 9441+499-215 = 9725。两者只差 17px！
// 都在 9700+ —— 不可能是 4096 边界。
// 放弃猜测。用 CDP DOMSnapshot 的 hit-test 真值：DOM.performSearch 不行，
// 用 「Layer 1 」：CDP DOM.getNodeForLocation(x, y)
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
await p.waitForTimeout(1500)
const cdp = await p.context().newCDPSession(p)
const box = await p.evaluate(() => {
  const r = [...document.querySelectorAll('.ProseMirror td')][2].getBoundingClientRect()
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
})
const nodeAt = await cdp.send('DOM.getNodeForLocation', { x: box.x, y: box.y, includeUserAgentShadowDOM: false })
console.log('CDP node at TD point:', JSON.stringify(nodeAt).slice(0, 300))
// 也查段落点
const paraBox = await p.evaluate(() => {
  const ps = [...document.querySelectorAll('.ProseMirror p')].filter(pp => { const rr = pp.getBoundingClientRect(); return rr.y > 80 && rr.y < 500 && rr.height > 8 })
  const rr = ps[ps.length - 1].getBoundingClientRect()
  return { x: Math.round(rr.x + 30), y: Math.round(rr.y + rr.height / 2) }
})
const nodeAt2 = await cdp.send('DOM.getNodeForLocation', { x: paraBox.x, y: paraBox.y, includeUserAgentShadowDOM: false })
console.log('CDP node at para point:', JSON.stringify(nodeAt2).slice(0, 300))
await b.close()
