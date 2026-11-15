// 全部干预无效。回头精确审视"未滚动 y=820 HIT" —— 当时表格在 y=9957
// 【视口外】。点击 (400, 820) 命中的是【首屏的段落】—— y=820 处的段落
// 文字。它 HIT。滚到 9957 后点击表格 MISS。
// 死区规律修正：**位于 scroller 视口下半的内容点击失效，上半正常**。
// 首屏 y=820 的段落 HIT —— 但它在 scroller 下半（scroller 255-870）！矛盾……
// 除非首屏那次 scroller 顶不是 255！首次测量（probe15）y=215 —— 那时
// 【分页还没跑完】。分页跑完后纸页多了 24px margin，scroller 变 255。
// 
// 啊等等 —— 有个从没查过的：PM 文档 y=-9203（transform 层顶）——
// 【pm-host 在 scroller 顶部之上 -9203px】！正 content 从 335 开始。
// 滚动后…… 不，这是文档坐标。
// 
// 直接测量死区边界随滚动位置的变化（多点位全扫描）：
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const b = await chromium.launch({ args: ['--no-sandbox'], headless: false })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(20000)
await p.goto('http://localhost:18400', { waitUntil: 'networkidle' })
await p.evaluate(() => localStorage.setItem('samoffice_theme', 'light'))
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
const buf = fs.readFileSync(DOC)
const form = new FormData()
form.append('file', new Blob([buf]), 'contract.docx')
const r = await fetch('http://localhost:18400/api/doc/open', { method: 'POST', body: form })
const j = await r.json()
await p.evaluate(d => window.__setDocForTest(d), j.document)
await p.waitForTimeout(2500)
await p.evaluate(() => {
  window.__hit = -1
  window.addEventListener('mousedown', () => { window.__hit = 1 }, true)
})
// 固定滚动位置，扫描整屏（打在 PM 内容上：x=500）
for (const st of [0, 2000, 8000]) {
  await p.evaluate(v => { document.querySelector('.flex-1.overflow-auto').scrollTop = v }, st)
  await p.waitForTimeout(1500)
  const geo = await p.evaluate(() => {
    const sc = document.querySelector('.flex-1.overflow-auto')
    const r = sc.getBoundingClientRect()
    return { scTop: Math.round(r.y), scBottom: Math.round(r.bottom) }
  })
  const out = []
  for (let y = geo.scTop + 20; y < geo.scBottom - 10; y += 80) {
    await p.evaluate(() => { window.__hit = -1 })
    await p.mouse.click(500, y)
    await p.waitForTimeout(100)
    const hit = await p.evaluate(() => window.__hit)
    out.push(y + (hit >= 0 ? '✓' : '✗'))
  }
  console.log(`st=${st} (sc ${geo.scTop}-${geo.scBottom}):`, out.join(' '))
}
await b.close()
