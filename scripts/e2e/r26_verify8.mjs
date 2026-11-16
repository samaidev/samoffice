// wrapper style 空、无 pg- 装饰。表格干净。但点不到！
// 流内外来表(在 pageRef)能点。唯一差异 = PM dom 内部 vs 外部。
// ★★★ 灵光：**PM 表格上方有一个巨大的 .pg-linebreak 断点**！
// pg-paper top=9256（第9张纸 9256~10379）。表格内容流位置 ~9622。
// 跨第 9→10 页界（9256+1123=10379 —— 表格 9622+487=10109 全在第9页内）。
// 但段落挤在 9622 前的每页都有 pg-linebreak（display:block; margin-top:巨大值）
// —— 表格【前面】的断点 span 在 PM dom 里 margin-top 巨大。
// 这些 span 在 paragraphs 之间 —— 段落可点！所以 linebreak 不吞事件。
// ★ 终极对照：**外来表放进 .ProseMirror dom 内**（PM DOMObserver 会删，
// 但删之前 500ms 内点击）—— 用 MutationObserver 监听删除时刻 + 立即点击：
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1000)
const buf = fs.readFileSync(DOC)
const form = new FormData()
form.append('file', new Blob([buf]), 'contract.docx')
const r = await fetch(BASE + '/api/doc/open', { method: 'POST', body: form })
const j = await r.json()
await p.evaluate(d => window.__setDocForTest(d), j.document)
await p.waitForTimeout(4000)
await p.evaluate(() => { [...document.querySelectorAll('.ProseMirror td')][2].scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(1000)
// 插入到 PM dom 的表格 wrapper 之前（作为兄弟）—— 不违反 PM 的 children 映射？
// 会。直接插（等 PM 清理前抢点）：
const setup = await p.evaluate(() => {
  const pm = window.__pmView.dom
  const td = [...document.querySelectorAll('.ProseMirror td')][2]
  const wrapper = td.closest('.tableWrapper')
  const t = document.createElement('table')
  t.setAttribute('data-tprobe', '1')
  t.style.cssText = 'border:2px solid #d33;width:300px;height:70px;background:#fffde7;position:relative;z-index:9'
  t.innerHTML = '<tr><td>IN-PM</td></tr>'
  wrapper.parentElement.insertBefore(t, wrapper) // PM dom 内、表格正上方
  window.__e = []
  window.addEventListener('pointerdown', e => window.__e.push(e.target.tagName + ':' + (e.target.textContent || '').slice(0, 6)), { capture: true, passive: true })
  const r = t.getBoundingClientRect()
  return { x: r.x + 40, y: r.y + 35, top: Math.round(r.top) }
})
// 立即点击（100ms 内 PM DOMObserver 大概率还没 flush）
await p.mouse.click(setup.x, setup.y)
await p.waitForTimeout(150)
const ev1 = await p.evaluate(() => window.__e)
console.log('immediate click in-PM foreign table:', JSON.stringify(ev1))
await b.close()
