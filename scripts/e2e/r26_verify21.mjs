// 每次渲染都重挂钩子（无 deps 的 useEffect cleanup 会把钩子置 undefined 后重挂）。
// 连续调两次时中间态可能 undefined。重试式调用。
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1000)
const setDoc = async (d) => {
  for (let i = 0; i < 10; i++) {
    const ok = await p.evaluate((dd) => {
      if (typeof window.__setDocForTest !== 'function') return false
      window.__setDocForTest(dd)
      return true
    }, d)
    if (ok) return true
    await p.waitForTimeout(300)
  }
  return false
}
const mk = (paraN) => {
  const blocks = []
  for (let i = 0; i < paraN; i++) blocks.push({ type: 'p', inline: ['第' + i + '段落内容测试 ' + 'x'.repeat(30)] })
  blocks.push({ type: 'table', rows: [
    [{ inline: ['参数'] }, { inline: ['模拟值'] }, { inline: ['步长'] }],
    [{ inline: ['P'] }, { inline: ['0.5'] }, { inline: ['1.5'] }],
  ] })
  return { meta: { title: 't' }, blocks }
}
for (const paraN of [3, 60, 300]) {
  const ok = await setDoc(mk(paraN))
  if (!ok) { console.log(`paras=${paraN}: hook failed`); continue }
  await p.waitForTimeout(2500)
  const cnt = await p.evaluate(() => document.querySelectorAll('.ProseMirror td').length)
  if (!cnt) { console.log(`paras=${paraN}: NO TABLE`); continue }
  await p.evaluate(() => { [...document.querySelectorAll('.ProseMirror td')][0].scrollIntoView({ block: 'center' }) })
  await p.waitForTimeout(600)
  await p.evaluate(() => { window.__e = []; window.addEventListener('pointerdown', () => window.__e.push(1), { capture: true, passive: true }) })
  const box = await p.evaluate(() => { const r = [...document.querySelectorAll('.ProseMirror td')][0].getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(250)
  const alive = (await p.evaluate(() => window.__e.length)) > 0
  console.log(`paras=${paraN}: ${alive ? 'ALIVE ✅' : 'DEAD'} (td=${cnt})`)
}
await b.close()
