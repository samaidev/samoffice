// A/B/C 全活 —— handler 内容无关！那 t22 的死层与 t23-C 活层的差异：
// t22 有【wrapper 闭包引用 + setTimeout 里的完整 dispatch 逻辑】——
// t23-C 的 handler 极简。逐步加料找毒药：这次直接加【setTimeout+dispatch】
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
await p.waitForTimeout(1200)
const mkVariant = async (variant) => {
  const pt = await p.evaluate(async (v) => {
    document.querySelectorAll('[data-variant]').forEach(e => e.remove())
    const code = `
      window.__vHit = ''
      const host = window.__pmView.dom.parentElement
      const w = host.querySelector('.tableWrapper')
      const wr = w.getBoundingClientRect(), hr = host.getBoundingClientRect()
      const d = document.createElement('div')
      d.dataset.variant = '${v}'
      d.style.cssText = 'position:absolute;left:' + (wr.left - hr.left + 6) + 'px;top:' + (wr.top - hr.top) + 'px;width:' + (wr.width - 12) + 'px;height:' + wr.height + 'px;z-index:7;background:rgba(0,0,0,0.003)'
      d.addEventListener('mousedown', (e) => {
        e.preventDefault()
        window.__vHit = '${v}'
        ${v === 'withtimeout' ? "setTimeout(() => { window.__vHit = '${v}+fired' }, 0)" : ''}
        ${v === 'withdispatch' ? `setTimeout(() => {
          const v2 = window.__pmView
          let pos = -1
          v2.state.doc.forEach((n, off) => { if (pos < 0 && n.type.name === 'table') pos = off })
          v2.dispatch(v2.state.tr.setSelection(v2.state.selection.constructor.near(v2.state.doc.resolve(pos + 4), 1)))
          v2.focus()
        }, 0)` : ''}
      })
      d.addEventListener('mouseup', (e) => e.preventDefault())
      host.appendChild(d)
    `
    const blob = new Blob([code], { type: 'text/javascript' })
    await import(URL.createObjectURL(blob))
    const w2 = window.__pmView.dom.parentElement.querySelector('.tableWrapper')
    const rect = w2.getBoundingClientRect()
    return { x: rect.x + rect.width * 0.6, y: rect.y + rect.height * 0.5 }
  }, variant)
  await p.mouse.click(pt.x, pt.y)
  await p.waitForTimeout(500)
  const hit = await p.evaluate(() => window.__vHit)
  return hit
}
console.log('withtimeout:', await mkVariant('withtimeout'))
console.log('withdispatch:', await mkVariant('withdispatch'))
await b.close()
