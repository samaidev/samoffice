// 内联 transform/contain 都不救。但「转移到 holder」救。
// 差异再缩小：转移 = appendChild 到新父（触发 re-layout + 层重建）+
// holder 有 background:#fff（不透明！）。
// ★★★ holder 有背景色！absolute + 不透明背景 → 合成器为它建了不透明层
// → hit-test 有了落点。死区 wrapper 是【透明】的！
// 立即验证：给 wrapper 加 background（哪怕 transparent→white→去掉）：
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
await p.evaluate(() => window.__setDocForTest({ meta: { title: 't' }, blocks: [
  { type: 'p', inline: [{ text: '段落' }] },
  { type: 'table', rows: [[{ inline: [{ text: 'A1' }] }, { inline: [{ text: 'B1' }] }]] },
] }))
await p.waitForTimeout(2500)
const test = async (name, apply) => {
  await p.evaluate((src) => { const fn = new Function(src); fn() }, apply.toString())
  await p.waitForTimeout(350)
  await p.evaluate(() => { window.__ev = 0; window.addEventListener('pointerdown', () => window.__ev++, { capture: true, passive: true }) })
  const box = await p.evaluate(() => { const r = document.querySelector('.ProseMirror td').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(220)
  console.log(`${name}:`, (await p.evaluate(() => window.__ev)) > 0 ? 'ALIVE ✅' : 'DEAD')
}
await test('wrapper 背景 #fff', () => { document.querySelector('.tableWrapper').style.background = '#fff' })
await test('table 背景 #fff', () => { document.querySelector('.ProseMirror table').style.background = '#fff' })
await test('td 背景 #fff', () => { for (const td of document.querySelectorAll('.ProseMirror td')) td.style.background = '#fff' })
await b.close()
