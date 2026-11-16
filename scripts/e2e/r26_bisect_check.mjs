// round26 bisect：表格死区快速判定脚本。
// 用法: node r26_bisect_check.mjs
// 判定：GOOD = 点击表格格后 pointerdown 事件到达 window 且能打字；BAD = 死区。
// 用小文档（1 表格）+ 直接构造，不依赖 upload 文件。
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
let pageErr = ''
p.on('pageerror', e => { pageErr = e.message.slice(0, 120) })
p.setDefaultTimeout(20000)
try {
  await p.goto(BASE, { waitUntil: 'domcontentloaded' })
  await p.waitForTimeout(1500)
  // 等 __setDocForTest 就绪（重试）
  let hookOk = false
  for (let i = 0; i < 10; i++) {
    hookOk = await p.evaluate(() => typeof window.__setDocForTest === 'function')
    if (hookOk) break
    await p.waitForTimeout(400)
  }
  if (!hookOk) { console.log('BAD-CHECK: hook not available' + (pageErr ? ' err=' + pageErr : '')); await b.close(); process.exit(2) }
  await p.evaluate(() => window.__setDocForTest({ meta: { title: 't' }, blocks: [
    { type: 'p', inline: [{ text: '段落' }] },
    { type: 'table', rows: [
      [{ inline: [{ text: 'A1' }] }, { inline: [{ text: 'B1' }] }],
      [{ inline: [{ text: 'A2' }] }, { inline: [{ text: 'B2' }] }],
    ] },
  ] }))
  await p.waitForTimeout(2500)
  const tdCount = await p.evaluate(() => document.querySelectorAll('.ProseMirror td').length)
  if (!tdCount) { console.log('BAD-CHECK: no table rendered'); await b.close(); process.exit(2) }
  const box = await p.evaluate(() => {
    const r = document.querySelector('.ProseMirror td').getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
  await p.evaluate(() => { window.__e = 0; window.addEventListener('pointerdown', () => window.__e++, { capture: true, passive: true }) })
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(250)
  const events = await p.evaluate(() => window.__e)
  console.log(events > 0 ? 'GOOD（表格可点击）' : 'BAD（死区）' + (pageErr ? ' pageerr=' + pageErr : ''))
  await b.close()
  process.exit(events > 0 ? 0 : 1)
} catch (e) {
  console.log('BAD-CHECK: ' + e.message.slice(0, 150))
  try { await b.close() } catch {}
  process.exit(2)
}
