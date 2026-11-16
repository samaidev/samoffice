// anchor 在 td[8] 的 "M" 文本上（正确！）但 scroll 已经是 16142 —— 
// 即【滚动发生在 anchor 设置之前的瞬间】—— 采样从点击后 ~280ms 开始
//（10283ms vs 点击时刻 ~10000ms）—— 跳变在点击后 0-280ms 间发生。
// 而 DOM-sel 同步段的 range 在 "M" —— range 正确 —— 
// ★★★★ 所以滚动来自【设置 range 的动作本身】：addRange 到 "M" 文本
// 节点 —— 该文本节点所在 DOM 的【文档流位置】在 16142？—— 但 t12
// 里 pos5174 的 DOM rectTop=450（视口内）docOffsetTop=10108 —— 
// ★★★ 矛盾唯一解：td[8] 有【两个 DOM 副本】（分页拆分把表格行分到
// 多页！）：视口内 10108 处是副本A，视口外 16142 附近是副本B —— 
// 我们的 findText 找到的 tdEl（querySelectorAll('tr')[r] 的第 r 行）
// 是【第一页的行】—— td[8]（第 r 行）在下一页 —— 但我们点的是
// 【视口内的副本】（rectTop 450 的那个）—— mousedown 的坐标匹配
// 命中了【视口内 td】→ r/c 对 → cellStart → PM pos 5174 → dispatch ✓
// → DOM-sel 同步：tdEl = wrapper 里第 r 行的第 c 格 —— 
// ★ wrapper.querySelectorAll('tr') 返回【所有 tr 含分页副本】！
// 行 r 对应的 tr 可能是【跨页拆分前的完整 tr】（在 16142 那页）——
// addRange 到那里的文本 → 浏览器滚动过去 → 跳变 6484！
// ◆ 验证：wrapper 里 tr 数量 vs 表格实际行数：
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
const st = await p.evaluate(() => {
  const wrap = document.querySelector('.tableWrapper')
  const trs = [...wrap.querySelectorAll('tr')]
  // PM doc 的表格行数
  const v = window.__pmView
  let pos = -1
  v.state.doc.forEach((n, off) => { if (pos < 0 && n.type.name === 'table') pos = off })
  let docRows = 0
  v.state.doc.nodeAt(pos).forEach(() => docRows++)
  // 分页区（.pm-page 等）里有没有 tr 副本
  const pages = document.querySelectorAll('.pm-page, [class*=page]')
  return {
    domTrs: trs.length, docRows,
    trPositions: trs.map((tr, i) => { const r = tr.getBoundingClientRect(); return { i, top: Math.round(r.top + document.querySelector('.overflow-auto').scrollTop), text: tr.textContent.slice(0, 8) } }),
    pagesCount: pages.length,
  }
})
console.log(JSON.stringify(st, null, 1))
await b.close()
