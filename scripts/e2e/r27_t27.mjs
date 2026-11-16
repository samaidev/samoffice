// ★★★★★ 历史性突破：left 区（width*0.15）proxy=HIT —— 产品层收到了！
// mid/right 无。死区是【部分区域】！0.15*542≈81px（左边缘内 75px 活）。
// 与 6px 边框容差组合 —— proxy left 偏移 6px + 表格首列边界 ——
// 【死区 = wrapper 内某个 x 范围】。而所有「活」的实验点击点都在
// wrapper*0.6 ≈ 325px —— 也死（mid=0.5 死、right=0.85 死）—— 
// 不对 —— t24 的 blob 层 0.6 活了…… 
// ◆ 等下 —— t24 的 0.6 是【w（wrapper）】的 0.6 = 325px —— 与 mid(271px)/
// right(460px) 都在死区 —— 但 t24 活！
// 区别：t24 的层 z:7！产品 z:6！z-index 6 vs 7 —— ★★★ z-index 就是毒药！
// pm-host 里 PM(auto) < proxy(6) —— 但 hit-test 缓存的层序里 z6 的
// proxy 排在某个不可见但「有 z」的旧层之下！t23/t24 的 z7 高于它。
// 立即验证：把产品 proxy z-index 6→7：
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
await p.waitForTimeout(5000)
// 只改 z-index：6 → 7
await p.evaluate(() => { document.querySelector('.pm-table-clickproxy').style.zIndex = '7' })
await p.waitForTimeout(300)
await p.evaluate(() => { window.__vH = ''; document.querySelector('.pm-table-clickproxy')?.addEventListener('mousedown', () => { window.__vH = 'HIT' }, true) })
const box = await p.evaluate(() => { const r = document.querySelector('td').getBoundingClientRect(); return { x: r.x + r.width * 0.6, y: r.y + r.height * 0.5 } })
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(400)
console.log('z=7 后 td 中心点击:', await p.evaluate(() => window.__vH) || '无')
await b.close()
