// 拖到行2中下（451）期望 R2R1R3R4，实测 R2R3R4R1（末尾）。
// target 判定明显偏高 1。怀疑【wrap 的行集合包含【分页装饰的 spacer 行】
// 或 PM 的 columnResizing ghost？—— wrap.querySelectorAll('tr') 若
// 有 8 个（4 真 + 4 ghost）—— mid 序列重复 —— 判定偏移！
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
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
  return { count: trs.length, detail: trs.map(tr => { const r = tr.getBoundingClientRect(); return { tag: tr.tagName, cls: (tr.className || '').toString().slice(0, 20), top: Math.round(r.top), h: Math.round(r.height), text: tr.textContent.slice(0, 6) } }) }
})
console.log(JSON.stringify(info, null, 1))
await b.close()
