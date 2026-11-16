// 视口内的流内外来表也活！那 PM 表格死的真正差异只剩：
// 它是【ProseMirror 管理的 NodeView DOM】。PM 会给 NodeView/其内容
// 打什么？→ **React 没参与，但 PM 的 DOMObserver 在 MutationObserver 回调**
// （subtree childList）里 stopEvent… 都不吞浏览器事件。
// ★ 唯一还没排除的：**分页引擎的 Decoration.node 在 wrapper 上写入了
// 什么内联样式**。看当前 wrapper 的真实内联 style！之前查过 class 只有
// tableWrapper —— 但 style 呢？？
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
const dom = await p.evaluate(() => {
  const td = [...document.querySelectorAll('.ProseMirror td')][2]
  const wrapper = td.closest('.tableWrapper')
  const table = td.closest('table')
  const dump = (el) => ({
    tag: el.tagName, cls: (el.getAttribute('class') || ''), style: (el.getAttribute('style') || '').slice(0, 200),
  })
  // wrapper 前面的兄弟（装饰可能挂在段落上）
  const prev = wrapper.previousElementSibling
  return {
    wrapper: dump(wrapper), table: dump(table),
    prev: prev ? { ...dump(prev), tag: prev.tagName } : null,
    // wrapper 在 PM children 中的索引
  }
})
console.log(JSON.stringify(dom, null, 1))
// 再看 PM dispatch 事务里 pagination meta 的 decos 是否含 wrapper 位置的 node deco
const deco = await p.evaluate(() => {
  const v = window.__pmView
  const st = v.state
  // 无法直接读 plugin state；查 PM dom 所有带 pg- 类的元素及其位置
  return [...document.querySelectorAll('[class*="pg-"]')].slice(0, 12).map(e => e.tagName + '.' + (e.className || '').toString().slice(0, 30) + ' style="' + (e.getAttribute('style') || '').slice(0, 60) + '"')
})
console.log('pg- decorations:', JSON.stringify(deco, null, 1))
await b.close()
