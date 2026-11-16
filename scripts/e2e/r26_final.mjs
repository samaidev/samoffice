import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 80)))
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
await p.evaluate(() => window.__setDocForTest({ meta: { title: 't' }, blocks: [
  { type: 'p', inline: [{ text: '段落' }] },
  { type: 'table', rows: [[{ inline: [{ text: 'A1' }] }, { inline: [{ text: 'B1' }] }]] },
] }))
await p.waitForTimeout(2200)
// 1) 有几个 .ProseMirror / tableWrapper（StrictMode 双挂载孤儿检测）
const dup = await p.evaluate(() => ({
  pmCount: document.querySelectorAll('.ProseMirror').length,
  wrappers: document.querySelectorAll('.tableWrapper').length,
  tables: document.querySelectorAll('.ProseMirror table').length,
  allTables: document.querySelectorAll('table').length,
  // 孤儿检测：不在 __pmView.dom 里的 table
  orphanTables: [...document.querySelectorAll('table')].filter(t => !window.__pmView.dom.contains(t)).length,
  // 祖先链中是否有第二个 contenteditable
  ceCount: document.querySelectorAll('[contenteditable=true]').length,
}))
console.log('dup check:', JSON.stringify(dup))
// 2) 删除所有孤儿节点后点击
if (dup.orphanTables > 0) {
  await p.evaluate(() => {
    const v = window.__pmView
    for (const t of [...document.querySelectorAll('table')]) {
      if (!v.dom.contains(t)) { const w = t.closest('.tableWrapper') || t; w.remove() }
    }
  })
  await p.waitForTimeout(400)
  await p.evaluate(() => { window.__e = []; window.addEventListener('pointerdown', () => window.__e.push(1), { capture: true, passive: true }) })
  const box = await p.evaluate(() => { const r = document.querySelector('.ProseMirror td').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(250)
  console.log('after orphan removal →', (await p.evaluate(() => window.__e.length)) > 0 ? 'ALIVE ✅✅✅' : 'DEAD')
}
await b.close()
