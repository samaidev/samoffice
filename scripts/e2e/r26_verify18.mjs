// 换直接构造：小文档（几段+表格）走 __setDocForTest
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1000)
const mk = (paraN) => {
  const blocks = []
  for (let i = 0; i < paraN; i++) blocks.push({ type: 'p', inline: ['第' + i + '段落内容测试 ' + 'x'.repeat(20)] })
  blocks.push({ type: 'table', rows: [
    [{ inline: ['参数'] }, { inline: ['模拟值'] }, { inline: ['步长'] }],
    [{ inline: ['P'] }, { inline: ['0.5'] }, { inline: ['1.5'] }],
  ] })
  blocks.push({ type: 'p', inline: ['表格后面的段落'] })
  return { meta: { title: 't' }, blocks }
}
for (const paraN of [3, 60, 300]) {
  await p.evaluate(d => window.__setDocForTest(d), mk(paraN))
  await p.waitForTimeout(2500)
  await p.evaluate(() => { [...document.querySelectorAll('.ProseMirror td')][0].scrollIntoView({ block: 'center' }) })
  await p.waitForTimeout(600)
  await p.evaluate(() => { window.__e = []; window.addEventListener('pointerdown', () => window.__e.push(1), { capture: true, passive: true }) })
  const box = await p.evaluate(() => { const r = [...document.querySelectorAll('.ProseMirror td')][0].getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(250)
  const alive = (await p.evaluate(() => window.__e.length)) > 0
  const sel = await p.evaluate(() => { const v = window.__pmView; return v.state.selection.from })
  console.log(`paras=${paraN}: ${alive ? 'ALIVE ✅' : 'DEAD'} selFrom=${sel}`)
}
await b.close()
