// 拖到行3中间（ty=行3 中心）期望 target=2，实际行为=插到末尾（target=4）。
// 行3 中心 = r3.top + h/2，条件 ev.clientY < r.top + h/2 对 i=2 是
// 「不小于」（正好中点）→ 继续 i=3：行4 中心更高 —— 都不满足 → target=4。
// ★ 边界等号问题 + 更可能：**trs 是 wrap 里的行 —— 但分页装饰可能拆分
// 表格为多个 tbody/tr**？行3 中心点 ty 精确吗 —— 用实际事件坐标验证：
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 150)))
p.setDefaultTimeout(30000)
await p.goto(BASE + '/?r=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(2000)
await p.evaluate(() => window.__setDocForTest({ meta: { title: 't' }, blocks: [
  { type: 'p', inline: [{ content: '段落一' }] },
  { type: 'table', rows: [
    [{ inline: [{ content: 'R1A' }] }, { inline: [{ content: 'R1B' }] }],
    [{ inline: [{ content: 'R2A' }] }, { inline: [{ content: 'R2B' }] }],
    [{ inline: [{ content: 'R3A' }] }, { inline: [{ content: 'R3B' }] }],
    [{ inline: [{ content: 'R4A' }] }, { inline: [{ content: 'R4B' }] }],
  ] },
] }))
await p.waitForTimeout(3000)
const info = await p.evaluate(() => {
  const wrap = document.querySelector('.tableWrapper')
  const trs = [...wrap.querySelectorAll('tr')]
  return trs.map(tr => { const r = tr.getBoundingClientRect(); return { top: Math.round(r.top), mid: Math.round(r.top + r.height / 2), bottom: Math.round(r.bottom), h: Math.round(r.height) } })
})
console.log('行几何:', JSON.stringify(info))
await b.close()
