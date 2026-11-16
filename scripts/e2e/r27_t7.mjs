// 服务端代码完整。v.focus() 后的同步段【没执行且无异常】—— 
// 唯一解释：v.focus() 之后某行【同步阻塞/中断回调】？不可能。
// 或者 —— 【延时回调根本没跑】，from=52 是【mousedown 原生点击 td】
// 产生的？！t1 里 proxy 存在 + 覆盖 —— 但点击也许落到了 td（proxy
// 也许 z-index 被 pm-host 里行号层压住？）—— elementFromPoint 显示
// proxy 在顶（fv9）…… 但那是旧版本。
// ★ 现在直接确认：点击时 proxy 的 mousedown handler 是否执行 ——
// 给 handler 打标记（通过劫持 wrapper 的 querySelectorAll 不行）——
// 用最直接的：点击后立刻查 from 的【变化时序】（10ms 间隔轮询）：
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
await p.waitForTimeout(600)
// 点击前先记录 from，然后立即连续轮询（mousedown→mouseup→setTimeout0 链）
await p.evaluate(() => { window.__fromSeq = []; window.__t0 = performance.now(); const iv = setInterval(() => { window.__fromSeq.push(Math.round(performance.now() - window.__t0) + ':' + window.__pmView.state.selection.from) }, 8); setTimeout(() => clearInterval(iv), 700) })
const box = await p.evaluate(() => { const r = document.querySelector('td').getBoundingClientRect(); return { x: r.x + r.width * 0.6, y: r.y + r.height * 0.5 } })
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(800)
console.log('from 变化:', JSON.stringify(await p.evaluate(() => window.__fromSeq.filter((s, i, a) => i === 0 || s.split(':')[1] !== a[i-1].split(':')[1]))))
await b.close()
