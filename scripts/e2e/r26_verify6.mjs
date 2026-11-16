// 流内外来表也死（target=HTML，即点击落空到 HTML）！fixed 外来表活。
// 死的条件 = 「流内元素 + 位于 pageRef 内部」。
// 但段落也是流内且在 PM 里 —— 活！y=499 活 / y=516 表格死。
// 等等……流内外来表加在 pageRef 的【末尾】（内容流 ~18000px 处）—— 
// 那里远离视口！sc.scrollTop+=200 后它在哪？可能根本不在视口里。
// 点击落空因为点了空白！实验有缺陷。重新精确做：插在视口中央。
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1000)
const buf = fs.readFileSync(DOC)
const form = new FormData()
form.append('file', new Blob([buf]), 'contract.docx')
const r = await fetch(BASE + '/api/doc/open', { method: 'POST', body: form })
const j = await r.json()
await p.evaluate(d => window.__setDocForTest(d), j.document)
await p.waitForTimeout(4000)
await p.evaluate(() => { [...document.querySelectorAll('.ProseMirror td')][2].scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(1000)
const setup = await p.evaluate(() => {
  // 在 pageRef 内、PM 表格正下方（视口内）插流内表
  const pageRef = window.__pmView.dom.closest('.mx-auto')
  const t = document.createElement('table')
  t.setAttribute('data-tprobe', '1')
  t.style.cssText = 'border:2px solid #d33;width:400px;height:80px;background:#fffde7'
  t.innerHTML = '<tr><td>STATIC2</td></tr>'
  pageRef.appendChild(t)
  t.scrollIntoView({ block: 'center' })
  const r = t.getBoundingClientRect()
  return { x: r.x + 50, y: r.y + 40, vis: r.y > 0 && r.y < 880 }
})
await p.waitForTimeout(600)
await p.evaluate(() => { window.__e = []; window.addEventListener('pointerdown', e => window.__e.push(e.target.tagName + ':' + (e.target.textContent || '').slice(0, 6)), { capture: true, passive: true }) })
console.log('setup:', JSON.stringify(setup))
await p.mouse.click(setup.x, setup.y)
await p.waitForTimeout(250)
console.log('in-view static foreign table →', JSON.stringify(await p.evaluate(() => window.__e)))
await b.close()
