// HMR 更新后可能整页 React 崩了（编辑器文件改动触发 fast-refresh 重载）。
// 重启浏览器全新加载一次即可恢复。加 pageerror 监听。
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 150)))
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
const hook = await p.evaluate(() => typeof window.__setDocForTest)
console.log('hook type:', hook)
const mk = (paraN) => {
  const blocks = []
  for (let i = 0; i < paraN; i++) blocks.push({ type: 'p', inline: [{ text: '第' + i + '段落内容测试 ' + 'x'.repeat(30) }] })
  blocks.push({ type: 'table', rows: [
    [{ inline: [{ text: '参数' }] }, { inline: [{ text: '模拟值' }] }, { inline: [{ text: '步长' }] }],
    [{ inline: [{ text: 'P' }] }, { inline: [{ text: '0.5' }] }, { inline: [{ text: '1.5' }] }],
  ] })
  return { meta: { title: 't' }, blocks }
}
for (const paraN of [3, 60, 300]) {
  await p.evaluate(d => window.__setDocForTest(d), mk(paraN))
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
