// NodeView 无罪。所有「重写后新建」都活 —— 包括完整复刻。
// ◆ 唯一没复刻的：**DocTableView 的 handle div 里 innerHTML SVG + 
// contenteditable=false** —— 已含。真实应用与重写版的本质区别只剩：
// 【真实编辑器是页面 load 时创建的；重写版是之后创建的】。
// → 高度怀疑页面 load 时序（React 首帧 + CSS 未全应用 + 字体未加载时
// 创建的 DOM）在层树里留下永久阴影。而字体加载完成后创建的都正常！
// ★★★ 决定性验证：在应用里【等 3 秒字体加载完】再 __setDocForTest
// （编辑器 mount 在字体就绪后）—— 之前所有实验 setDoc 都在 load 后
// ~1.2s。检查 document.fonts.status 并在 ready 后再挂载：
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
// 等 fonts.ready
await p.evaluate(() => document.fonts.ready.then(() => { window.__fontsReady = true }))
await p.waitForFunction(() => window.__fontsReady === true, null, { timeout: 15000 }).catch(() => console.log('fonts not ready in 15s'))
await p.waitForTimeout(500)
await p.evaluate(() => window.__setDocForTest({ meta: { title: 't' }, blocks: [
  { type: 'p', inline: [{ text: '段落' }] },
  { type: 'table', rows: [[{ inline: [{ text: 'A1' }] }, { inline: [{ text: 'B1' }] }]] },
] }))
await p.waitForTimeout(3000)
await p.evaluate(() => { window.__ev = 0; window.addEventListener('pointerdown', () => window.__ev++, { capture: true, passive: true }) })
const box = await p.evaluate(() => { const r = document.querySelector('.ProseMirror td').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(250)
console.log('fonts.ready 后挂载:', (await p.evaluate(() => window.__ev)) > 0 ? 'ALIVE ✅✅✅' : 'DEAD')
await b.close()
