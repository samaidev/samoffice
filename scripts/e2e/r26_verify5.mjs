// PM 表格仍死、外来表活 —— 二者唯一的 DOM 差异：外来表 position:fixed。
// PM 表格是普通流内元素！死区=wrapper 矩形（probe26 证明）。
// 流内外来表测试：把外来表以【流内 static】方式塞进 pm-host（PM 外，
// React 不管的容器里 pm-host 有 children=undefined —— 直接 DOM append 会
// 被 React 在下一次 render 清掉，但点击前 500ms 内应该还在）：
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
// 滚动到文档底部附近（避开 PM 表格），在 pageRef 内追加流内外来表
const setup = await p.evaluate(() => {
  const pageRef = window.__pmView.dom.closest('.mx-auto')
  const sc = document.querySelector('.flex-1.overflow-auto')
  // 在 pageRef 末尾（编辑器之后）插入一个流内 table —— pageRef 是 React 的，
  // 但 children 追加到它内部尾部通常存活到下次 render
  const t = document.createElement('table')
  t.setAttribute('data-tprobe', '1')
  t.style.cssText = 'border:1px solid #333;width:400px;height:80px;background:#fffde7;margin:10px 0 400px 100px'
  t.innerHTML = '<tr><td>STATIC</td></tr>'
  pageRef.appendChild(t)
  const r = t.getBoundingClientRect()
  sc.scrollTop += 200
  return { x: r.x + 50, y: r.y + 40 }
})
await p.waitForTimeout(500)
await p.evaluate(() => { window.__e = []; window.addEventListener('pointerdown', e => window.__e.push(e.target.tagName + ':' + (e.target.textContent || '').slice(0, 6)), { capture: true, passive: true }) })
await p.mouse.click(setup.x, setup.y)
await p.waitForTimeout(250)
console.log('static foreign table in pageRef →', JSON.stringify(await p.evaluate(() => window.__e)))
await b.close()
