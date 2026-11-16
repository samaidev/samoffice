// 外置修复验证：小文档 + 真实文档，点击/打字/滚动跟随/多表格
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 120)))
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
// A) 小文档
await p.evaluate(() => window.__setDocForTest({ meta: { title: 't' }, blocks: [
  { type: 'p', inline: [{ content: '段落内容一' }] },
  { type: 'table', rows: [
    [{ inline: [{ content: 'A1' }] }, { inline: [{ content: 'B1' }] }],
    [{ inline: [{ content: 'A2' }] }, { inline: [{ content: 'B2' }] }],
  ] },
  { type: 'p', inline: [{ content: '表格后的段落' }] },
] }))
await p.waitForTimeout(3000)
const extState = await p.evaluate(() => {
  const w = document.querySelector('.tableWrapper')
  const pm = window.__pmView.dom
  return {
    externalized: !!w && !pm.contains(w),
    host: w?.parentElement?.className?.toString().slice(0, 30) || w?.parentElement?.tagName,
    pos: w ? getComputedStyle(w).position : null,
    tdText: document.querySelector('td')?.textContent,
    // 表格后段落位置是否被表格挤压（外置后 PM 内表格占位 0 → 后段顶上来？）
    gapOK: (() => { const p2 = [...document.querySelectorAll('.ProseMirror p')].pop(); return p2?.getBoundingClientRect().top })(),
  }
})
console.log('外置状态:', JSON.stringify(extState))
const clickAndType = async (i, ch) => {
  await p.evaluate(() => { window.__ev = 0; window.addEventListener('pointerdown', () => window.__ev++, { capture: true, passive: true }) })
  const box = await p.evaluate((idx) => { const tds = [...document.querySelectorAll('td')]; const r = tds[idx].getBoundingClientRect(); return { x: r.x + r.width * 0.7, y: r.y + r.height * 0.5, vis: r.y > 0 && r.y < 880 } }, i)
  if (!box.vis) return { skip: true }
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(300)
  const ev = await p.evaluate(() => window.__ev)
  await p.keyboard.type(ch, { delay: 50 })
  await p.waitForTimeout(300)
  const txt = await p.evaluate((idx) => [...document.querySelectorAll('td')][idx]?.textContent, i)
  return { alive: ev > 0, txt }
}
console.log('td[0]:', JSON.stringify(await clickAndType(0, 'Q')))
console.log('td[3]:', JSON.stringify(await clickAndType(3, 'W')))
// B) 真实文档
const buf = fs.readFileSync(DOC)
const form = new FormData()
form.append('file', new Blob([buf]), 'contract.docx')
const r = await fetch(BASE + '/api/doc/open', { method: 'POST', body: form })
const j = await r.json()
await p.evaluate(d => window.__setDocForTest(d), j.document)
await p.waitForTimeout(4500)
await p.evaluate(() => { [...document.querySelectorAll('td')][2].scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(1200)
const scrollFollow = await p.evaluate(() => {
  const w = document.querySelector('.tableWrapper')
  const td = [...document.querySelectorAll('td')][2]
  const wr = w.getBoundingClientRect(), tr = td.getBoundingClientRect()
  return { tdInWrapper: td.closest('.tableWrapper') === w, tdVisible: tr.y > 0 && tr.y < 880, wTop: Math.round(wr.top) }
})
console.log('真实文档滚动跟随:', JSON.stringify(scrollFollow))
console.log('真实 td[2]:', JSON.stringify(await clickAndType(2, 'Z9')))
// 滚动后再点（验证滚动同步）
await p.evaluate(() => { document.querySelector('.overflow-auto').scrollTop += 600 })
await p.waitForTimeout(600)
console.log('滚动+600后 td[2]:', JSON.stringify(await clickAndType(2, 'Y8')))
await b.close()
