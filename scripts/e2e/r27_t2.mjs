// 怀疑：dispatch 后 PM 的 selectionToDOM 立刻把 DOM selection 拉回
//（anchor=P 是 PM 的 domObserver flush 行为）。验证时序：
// 在延时回调里逐帧观察 anchor 变化 + td 内文本节点是否存在
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
await p.waitForTimeout(2500)
const pb = await p.evaluate(() => { const r = document.querySelector('.ProseMirror p').getBoundingClientRect(); return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.5 } })
await p.mouse.click(pb.x, pb.y)
await p.waitForTimeout(600)
// 监听 selectionchange 时序
await p.evaluate(() => {
  window.__selSeq = []
  document.addEventListener('selectionchange', () => {
    const a = window.getSelection()?.anchorNode
    window.__selSeq.push(Math.round(performance.now()) + ':' + (a?.nodeName || 'null') + (a?.parentElement?.closest('td') ? '(td)' : ''))
  })
})
const box = await p.evaluate(() => { const r = document.querySelector('td').getBoundingClientRect(); return { x: r.x + r.width * 0.6, y: r.y + r.height * 0.5 } })
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(1000)
console.log('selection 时序:', JSON.stringify(await p.evaluate(() => window.__selSeq.slice(0, 12))))
// td 里的文本节点长什么样
const tdStruct = await p.evaluate(() => {
  const td = document.querySelector('td')
  const dump = (el, d) => {
    if (d > 4) return ''
    return [...el.childNodes].map(n => n.nodeType === 3 ? '"' + n.textContent + '"' : '<' + n.nodeName + (n.className ? '.' + n.className : '') + '>' + dump(n, d + 1)).join(' ')
  }
  return dump(td, 0)
})
console.log('td 结构:', tdStruct)
await b.close()
