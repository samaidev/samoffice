import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 150)))
p.setDefaultTimeout(30000)
await p.goto(BASE + '/?r=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
// 带固定列宽的居中窄表格（模拟 Word 固定列宽表格居中）
await p.evaluate(() => window.__setDocForTest({ meta: { title: 't' }, blocks: [
  { type: 'p', inline: [{ content: '窄表格居中测试' }] },
  { type: 'table', align: 'center', rows: [
    [{ inline: [{ content: 'A1' }], colwidth: 120 }, { inline: [{ content: 'B1' }], colwidth: 120 }],
    [{ inline: [{ content: 'A2' }], colwidth: 120 }, { inline: [{ content: 'B2' }], colwidth: 120 }],
  ] },
] }))
await p.waitForTimeout(3000)
const ed = await p.evaluate(() => {
  const t = document.querySelector('.ProseMirror:not(.pm-nocaret) table')
  const w = t.closest('.tableWrapper')
  const pm = document.querySelector('.ProseMirror:not(.pm-nocaret)')
  const wr = w.getBoundingClientRect(), pmr = pm.getBoundingClientRect()
  const cs = getComputedStyle(w)
  return {
    tableW: Math.round(t.getBoundingClientRect().width),
    ml: cs.marginLeft, mr: cs.marginRight,
    leftGap: Math.round(wr.left - pmr.left), rightGap: Math.round(pmr.right - wr.right),
    centered: Math.abs((wr.left - pmr.left) - (pmr.right - wr.right)) < 12,
    styleAttr: (t.getAttribute('style') || '').slice(0, 80),
  }
})
console.log('编辑器窄居中表格:', JSON.stringify(ed, null, 1))
await p.evaluate(() => { const v = [...document.querySelectorAll('button')].find(t => t.textContent?.trim() === 'View'); v?.click() })
await p.waitForTimeout(600)
await p.evaluate(() => { document.querySelector('[data-testid=word-print-btn]')?.click() })
await p.waitForTimeout(2000)
const pv = await p.evaluate(() => {
  const host = document.querySelector('.pm-nocaret')
  if (!host) return { found: false }
  const t = host.querySelector('table')
  const w = t.closest('.tableWrapper')
  const cs = getComputedStyle(w)
  const wr = w.getBoundingClientRect(), hr = host.getBoundingClientRect()
  return {
    found: true,
    tableW: Math.round(t.getBoundingClientRect().width), hostW: Math.round(hr.width),
    ml: cs.marginLeft, mr: cs.marginRight,
    leftGap: Math.round(wr.left - hr.left), rightGap: Math.round(hr.right - wr.right),
    centered: Math.abs((wr.left - hr.left) - (hr.right - wr.right)) < 12,
    styleAttr: (t.getAttribute('style') || '').slice(0, 80),
  }
})
console.log('预览窄居中表格:', JSON.stringify(pv, null, 1))
await b.close()
