// 行拖拽换位置验证：
// 1) 选中行1（CellSelection）→ 按住行1 拖到行2 下方 → 松开
// 2) 校验行顺序变化 + 内容正确
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 150)))
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
await p.evaluate(() => window.__setDocForTest({ meta: { title: 't' }, blocks: [
  { type: 'p', inline: [{ content: '段落一' }] },
  { type: 'table', rows: [
    [{ inline: [{ content: 'R1A' }] }, { inline: [{ content: 'R1B' }] }],
    [{ inline: [{ content: 'R2A' }] }, { inline: [{ content: 'R2B' }] }],
    [{ inline: [{ content: 'R3A' }] }, { inline: [{ content: 'R3B' }] }],
  ] },
] }))
await p.waitForTimeout(3000)
// 激活管理器（首次交互）
const pb = await p.evaluate(() => { const r = document.querySelector('.ProseMirror p').getBoundingClientRect(); return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.5 } })
await p.mouse.click(pb.x, pb.y)
await p.waitForTimeout(2600)
// 通过 import 拿 CellSelection 选中行1：
await p.evaluate(async () => {
  const pt = await import('/node_modules/.vite/deps/prosemirror-tables.js?v=c6389b72').catch(() => null)
  if (!pt) { window.__csFail = 'import'; return }
  const v = window.__pmView
  let pos = -1
  v.state.doc.forEach((n, off) => { if (pos < 0 && n.type.name === 'table') pos = off })
  // 行1: anchor=首格(pos+2) head=末格
  const row0 = v.state.doc.nodeAt(pos).child(0)
  let lastCell = pos + 2
  row0.forEach((c, off) => { lastCell = pos + 2 + off })
  v.dispatch(v.state.tr.setSelection(pt.CellSelection.create(v.state.doc, pos + 2, lastCell)))
})
await p.waitForTimeout(500)
const selOk = await p.evaluate(() => { const s = window.__pmView.state.selection; return !!(s && s.$anchorCell && s.$headCell) })
console.log('行1 CellSelection:', selOk ? '✅' : '❌')
if (selOk) {
  // 拖拽：从行1中心按住 → 移到行3下方 → 松开
  const g = await p.evaluate(() => {
    const trs = [...document.querySelectorAll('.ProseMirror tr')]
    const r1 = trs[0].getBoundingClientRect()
    const r3 = trs[2].getBoundingClientRect()
    return { sx: r1.x + r1.width * 0.5, sy: r1.y + r1.height * 0.5, ty: r3.bottom - 5 }
  })
  await p.mouse.move(g.sx, g.sy)
  await p.mouse.down()
  await p.waitForTimeout(120)
  await p.mouse.move(g.sx, g.ty, { steps: 8 })
  await p.waitForTimeout(250)
  await p.mouse.up()
  await p.waitForTimeout(800)
  const rows = await p.evaluate(() => [...document.querySelectorAll('.ProseMirror tr')].map(tr => tr.textContent))
  console.log('拖拽后行序:', JSON.stringify(rows))
  console.log('doc 行序:', JSON.stringify(await p.evaluate(() => { const v = window.__pmView; let pos = -1; v.state.doc.forEach((n, off) => { if (pos < 0 && n.type.name === 'table') pos = off }); const out = []; v.state.doc.nodeAt(pos).forEach(r => out.push(r.textContent)); return out })))
}
await b.close()
