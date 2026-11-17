// ★ 疑点聚焦：编辑器表格 554px 宽但 tableStyle 无 width —— 
//（编辑器里 width:100%（CSS）+ colgroup 空 = 表格占满内容区）
// 该文档表格没有 colwidth（allW=false）→ 编辑器里 auto 布局拉满 554。
// 预览容器：scale 0.302267 → scaleW = 内容宽*1.5/pageWidthPx —— 
// 预览纸的内容区（纸宽-边距）*1.5 后 ≈ 554*0.302=167px 实际 —— 
// 表格 CSS width:100% 在预览里应该也占满 —— 但实测只 124px！
// ★ 预览的 .ProseMirror table { width:100% } 样式【没生效】—— 
// 克隆的 HTML 放进预览容器 —— 容器是 div（不是 .ProseMirror 类）—— 
// CSS 选择器 .ProseMirror table 不匹配预览里的 table！
// → 表格退化为内容自适应宽度（auto）= 124px + 无边框样式丢失。
// ★★★ 修法：预览克隆的根元素加 .ProseMirror 类（或把关键表格样式
// 做成全局 .pm-table 规则）。同样检查 pm-table 等样式作用域。
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 150)))
p.setDefaultTimeout(30000)
await p.goto(BASE + '/?r=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
const buf = fs.readFileSync(DOC)
const form = new FormData()
form.append('file', new Blob([buf]), 'contract.docx')
const r = await fetch(BASE + '/api/doc/open', { method: 'POST', body: form })
const j = await r.json()
await p.evaluate(d => window.__setDocForTest(d), j.document)
await p.waitForTimeout(4000)
// 打开打印预览
await p.evaluate(() => { const v = [...document.querySelectorAll('button')].find(t => t.textContent?.trim() === 'View'); v?.click() })
await p.waitForTimeout(500)
await p.evaluate(() => { document.querySelector('[data-testid=word-print-btn]')?.click() })
await p.waitForTimeout(1500)
// 预览表格的生效样式
const pv = await p.evaluate(() => {
  const t = [...document.querySelectorAll('table')].find(x => !x.closest('.ProseMirror'))
  if (!t) return { found: false }
  const cs = getComputedStyle(t)
  // 预览根容器有没有 ProseMirror 类
  let anc = t.parentElement, chain = []
  while (anc && chain.length < 8) { chain.push(anc.className?.toString().slice(0, 24) || anc.tagName); anc = anc.parentElement }
  return {
    found: true,
    tableW: Math.round(t.getBoundingClientRect().width),
    cssWidth: cs.width, cssTableLayout: cs.tableLayout,
    margin: cs.marginLeft + '/' + cs.marginRight,
    border: cs.borderTopWidth + ' ' + cs.borderTopColor,
    ancestorChain: chain,
    styleAttr: t.getAttribute('style')?.slice(0, 60),
  }
})
console.log('预览表格详情:', JSON.stringify(pv, null, 1))
await b.close()
