// PAGEERR: Position -1 —— tablePos=-1（forEach 没找到 table！因为表格是
// [unsupported block]？—— 不，doc 里有 table。等一下：PAGEERR 说 fragment
// 里只有两个 paragraph + "[unsupported block]"！
// —— 文档变成：p(段落) + p(unsupported) + p(表格后段落)? 
// 不是。看真实 PM doc 结构：
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 150)))
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
await p.evaluate(() => window.__setDocForTest({ meta: { title: 't' }, blocks: [
  { type: 'p', inline: [{ content: '段落内容一' }] },
  { type: 'table', rows: [
    [{ inline: [{ content: 'A1' }] }, { inline: [{ content: 'B1' }] }],
    [{ inline: [{ content: 'A2' }] }, { inline: [{ content: 'B2' }] }],
  ] },
] }))
await p.waitForTimeout(3000)
const docDump = await p.evaluate(() => {
  const v = window.__pmView
  const top = []
  v.state.doc.forEach((n, off) => top.push(off + ':' + n.type.name + '[' + n.textContent.slice(0, 8) + ']'))
  // td 的 DOM 顺序与 doc 的 cell 对应关系
  const w = document.querySelector('.tableWrapper')
  const tbody = w.querySelector('tbody')
  const domRows = [...tbody.children].map(tr => [...tr.children].map(td => td.textContent))
  return { top, domRows, inPM: v.dom.contains(w) }
})
console.log(JSON.stringify(docRows => docRows, null, 1))
console.log(JSON.stringify(docDump, null, 1))
await b.close()
