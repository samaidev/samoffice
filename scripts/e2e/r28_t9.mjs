// 纯 dispatch 不滚 —— 跳动来自【点击链路的其他环节】。
// 区分：①我们 applySel 的 60ms 补刀里 focus() ②原生 selectionchange
// ③DOM Selection 同步段（range 在另一个分页副本上 → 浏览器滚动
// 到 range 位置！）★ 高度怀疑 ③：DOM-sel 同步 findText(tdEl) 用的
// tdEl 是「实时 wrapper」里的 —— 但分页布局下同一格可能在多页有
// 副本 —— 我们 addRange 的 range 可能落在【视口外的分页副本】→
// 浏览器把 caret 滚动到那个副本 → 页面跳走！
// 验证：点击 td[8] 后看 DOM selection 的 anchorNode 在视口内还是外：
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
const box = await p.evaluate(() => { const tds = [...document.querySelectorAll('td')]; const td = tds[8]; const r = td.getBoundingClientRect(); return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.5, rectTop: r.top, vis: r.y > 40 && r.y < 870 } })
console.log('td[8] 点击前位置:', JSON.stringify(box))
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(100)
// 滚动发生前后快速采样 + 最终 anchor 位置
const st = await p.evaluate(() => {
  const a = window.getSelection()?.anchorNode
  const el = a?.nodeType === 3 ? a.parentElement : (a || undefined)
  const r = el?.getBoundingClientRect?.()
  return {
    anchorNode: a?.nodeName,
    anchorText: a?.textContent?.slice(0, 10),
    anchorRectTop: r ? Math.round(r.top) : null,
    anchorInViewport: r ? (r.top > 0 && r.top < 900) : null,
    scrollNow: document.querySelector('.overflow-auto').scrollTop,
  }
})
console.log('点击后 DOM selection:', JSON.stringify(st))
await b.close()
