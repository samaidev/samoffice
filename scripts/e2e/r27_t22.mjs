// 动态 module 建层也活！module/evaluate/MC/rIC 全活 —— 只有产品
// DocumentEditor effect 内建的死。现在二分到极致：
// 在产品代码的【ensureProxy 里】把建层动作委托给【动态 import 的
// blob module】—— 如果活，则修复方案成立（虽然荒谬）。
// 先模拟：把产品的 ensureProxy 全部逻辑搬进 blob module 测试。
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
await p.waitForTimeout(1000)
// 删除产品建的死 proxy，用 blob module 建【产品同款逻辑】的 proxy：
const pt = await p.evaluate(async () => {
  // 删产品 proxy
  document.querySelector('.pm-table-clickproxy')?.remove()
  const code = `
    // 产品 ensureProxy 的完整复刻（含 mousedown 语义）
    window.__blobProxyHit = ''
    window.__blobFrom = -1
    const host = window.__pmView.dom.parentElement
    const wrapper = host.querySelector('.tableWrapper')
    const w = wrapper
    const wr = w.getBoundingClientRect(), hr = host.getBoundingClientRect()
    const proxy = document.createElement('div')
    proxy.className = 'pm-table-clickproxy'
    proxy.style.cssText = 'position:absolute;z-index:6;background:rgba(0,0,0,0.003)'
    proxy.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return
      const v = window.__pmView
      if (!v) return
      const rows = wrapper.querySelectorAll('tr')
      let hit = null
      rows.forEach((tr, r) => {
        if (hit) return
        tr.querySelectorAll('td,th').forEach((td, c) => {
          if (hit) return
          const rect = td.getBoundingClientRect()
          if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) hit = { r, c }
        })
      })
      if (!hit) return
      window.__blobProxyHit = 'hit'
      e.preventDefault()
      setTimeout(() => {
        try {
          const v2 = window.__pmView
          let pos = -1
          v2.state.doc.forEach((n, off) => {
            if (pos < 0 && n.type.name === 'table') {
              const d = v2.nodeDOM(off)
              if (d === wrapper) pos = off
            }
          })
          if (pos < 0) { v2.focus(); return }
          const table = v2.state.doc.nodeAt(pos)
          const rowArr = []
          table.forEach((row, off) => rowArr.push({ off, node: row }))
          const row = rowArr[hit.r]
          const cells = []
          row.node.forEach((cell, off) => cells.push({ off, node: cell }))
          const cellStart = pos + 1 + row.off + 1 + cells[hit.c].off
          const target = cellStart + 1
          v2.dispatch(v2.state.tr.setSelection(v2.state.selection.constructor.near(v2.state.doc.resolve(target), 1)))
          v2.focus()
          window.__blobFrom = v2.state.selection.from
          // DOM sel 同步
          const tdEl = wrapper.querySelectorAll('tr')[hit.r]?.querySelectorAll('td,th')[hit.c]
          const findText = (el) => { for (const n of Array.from(el.childNodes)) { if (n.nodeType === 3) return n; const rr = findText(n); if (rr) return rr } return null }
          const tn = tdEl ? findText(tdEl) : null
          if (tn) {
            const range = document.createRange()
            range.setStart(tn, 0)
            range.collapse(true)
            const sel = window.getSelection()
            sel.removeAllRanges()
            sel.addRange(range)
          }
        } catch (err) { window.__blobFrom = 'ERR:' + String(err).slice(0, 80) }
      }, 0)
    })
    proxy.addEventListener('mouseup', (e) => e.preventDefault())
    host.appendChild(proxy)
    proxy.style.display = 'block'
    proxy.style.left = (wr.left - hr.left + 6) + 'px'
    proxy.style.top = (wr.top - hr.top) + 'px'
    proxy.style.width = Math.max(0, wr.width - 12) + 'px'
    proxy.style.height = wr.height + 'px'
  `
  const blob = new Blob([code], { type: 'text/javascript' })
  await import(URL.createObjectURL(blob))
  const w2 = window.__pmView.dom.parentElement.querySelector('.tableWrapper')
  const rect = w2.getBoundingClientRect()
  return { x: rect.x + rect.width * 0.6, y: rect.y + rect.height * 0.5 }
})
await p.mouse.click(pt.x, pt.y)
await p.waitForTimeout(700)
console.log('blob proxy mousedown:', await p.evaluate(() => window.__blobProxyHit) || '无')
console.log('blob from:', await p.evaluate(() => window.__blobFrom))
await p.keyboard.type('Q5', { delay: 70 })
await p.waitForTimeout(400)
console.log('td[0]:', JSON.stringify(await p.evaluate(() => document.querySelector('td')?.textContent)))
await b.close()
