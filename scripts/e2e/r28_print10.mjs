// 居中表格场景：构造 align=center 的窄表格文档 → 预览里 margin:auto 应生效
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 150)))
p.setDefaultTimeout(30000)
await p.goto(BASE + '/?r=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
// 带居中属性的表格（UDM 里 table align 属性）
await p.evaluate(() => window.__setDocForTest({ meta: { title: 't' }, blocks: [
  { type: 'p', inline: [{ content: '居中表格测试' }] },
  { type: 'table', align: 'center', rows: [
    [{ inline: [{ content: 'A1' }] }, { inline: [{ content: 'B1' }] }],
    [{ inline: [{ content: 'A2' }] }, { inline: [{ content: 'B2' }] }],
  ] },
] }))
await p.waitForTimeout(3000)
// 编辑器里表格居中状态
const ed = await p.evaluate(() => {
  const t = document.querySelector('.ProseMirror:not(.pm-nocaret) table')
  const w = t.closest('.tableWrapper')
  const cs = getComputedStyle(w)
  return { ml: cs.marginLeft, mr: cs.marginRight, dataAlign: t.getAttribute('data-align') }
})
console.log('编辑器居中表格:', JSON.stringify(ed))
// 打开预览
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
    ml: cs.marginLeft, mr: cs.marginRight,
    // 居中判定：wrapper 两侧留白接近
    leftGap: Math.round(wr.left - hr.left), rightGap: Math.round(hr.right - wr.right),
    centered: Math.abs((wr.left - hr.left) - (hr.right - wr.right)) < 12,
    tableW: Math.round(t.getBoundingClientRect().width), hostW: Math.round(hr.width),
  }
})
console.log('预览居中表格:', JSON.stringify(pv, null, 1))
await b.close()
