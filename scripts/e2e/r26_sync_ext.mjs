// 同步外置验证：doc 保住？点击活？打字进格？
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 100)))
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
const st = await p.evaluate(() => {
  const v = window.__pmView
  const a = []
  v.state.doc.forEach((n, off) => a.push(off + ':' + n.type.name))
  const w = document.querySelector('.tableWrapper')
  return { docTop: a, wInPM: w ? v.dom.contains(w) : null, tdText: document.querySelector('td')?.textContent }
})
console.log('同步外置状态:', JSON.stringify(st))
// 点击 + 打字
await p.evaluate(() => { window.__ev = 0; window.addEventListener('pointerdown', () => window.__ev++, { capture: true, passive: true }) })
const box = await p.evaluate(() => { const td = document.querySelector('td'); if (!td) return null; const r = td.getBoundingClientRect(); return { x: r.x + r.width * 0.7, y: r.y + r.height * 0.5 } })
if (box) {
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(350)
  const alive = (await p.evaluate(() => window.__ev)) > 0
  const sel = await p.evaluate(() => ({ from: window.__pmView.state.selection.from, focus: window.__pmView.hasFocus() }))
  console.log('点击:', alive ? 'ALIVE ✅' : 'DEAD', JSON.stringify(sel))
  await p.keyboard.type('Q5', { delay: 60 })
  await p.waitForTimeout(400)
  console.log('td[0]:', JSON.stringify(await p.evaluate(() => document.querySelector('td')?.textContent)))
}
await b.close()
