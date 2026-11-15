// 本地热点定位：打字时哪些东西在反复跑
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(25000)
await p.goto('http://localhost:18400', { waitUntil: 'networkidle' })
await p.evaluate(() => localStorage.setItem('samoffice_theme', 'light'))
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(1000)
const buf = fs.readFileSync(DOC)
const form = new FormData()
form.append('file', new Blob([buf]), 'contract.docx')
const r = await fetch('http://localhost:18400/api/doc/open', { method: 'POST', body: form })
const j = await r.json()
await p.evaluate(d => window.__setDocForTest(d), j.document)
await p.waitForTimeout(6000)
// 热点探针
await p.evaluate(() => {
  window.__probe = { katexRender: 0, mathNodeCreate: 0, transactions: 0, paginate: 0, spell: 0 }
  // KaTeX render 计数：包装 katex.render
  if (window.katex) {
    const orig = window.katex.render.bind(window.katex)
    window.katex.render = (...args) => { window.__probe.katexRender++; return orig(...args) }
  }
  const pm = window.__pmView
  const origDisp = pm.dispatch.bind(pm)
  pm.dispatch = (tr) => {
    window.__probe.transactions++
    if (tr.meta && ('forcePaginate' in tr.meta)) window.__probe.paginate++
    if (tr.meta && ('spellCheck$' in tr.meta)) window.__probe.spell++
    return origDisp(tr)
  }
  // DOM 重建检测：MutationObserver on math 容器
  let mathRebuild = 0
  const mo = new MutationObserver(list => { mathRebuild += list.filter(m => m.type === 'childList').length })
  const pmRoot = pm.dom
  mo.observe(pmRoot, { childList: true, subtree: false })
  window.__probe.getMathRebuild = () => mathRebuild
})
// 点击第一个段落 + 连续打 5 个字符
const pt = await p.evaluate(() => {
  for (const el of document.querySelectorAll('.ProseMirror p')) {
    const r = el.getBoundingClientRect()
    if (r.y > 300 && r.y < 600 && el.textContent.trim().length > 5) return { x: r.x + 40, y: r.y + r.height / 2 }
  }
})
await p.mouse.click(pt.x, pt.y)
await p.waitForTimeout(400)
const t0 = Date.now()
await p.keyboard.type('abcde', { delay: 120 })
const typeMs = Date.now() - t0
await p.waitForTimeout(2500)
const probe = await p.evaluate(() => ({ ...window.__probe, mathRebuild: window.__probe.getMathRebuild() }))
console.log(`打 5 键耗时 ${typeMs}ms（含间隔600ms）`)
console.log('探针:', JSON.stringify(probe))
await b.close()
