// 纸层 inset:0 z=0 pe=none —— 但覆盖 TD 视觉区域的还有
// 「pageRef 容器 onDoubleClick/onMouseDown 的 React 处理」无关。
// 还有个被我漏掉的：**katex-mathml SPAN pe=auto 1x1** —— 1x1 不挡。
// ★ 灵光乍现：Chromium 合成器 hit-test 有个已知坑 ——
// **表格在 column layout 里**？无。
// **TD 的祖先 TABLE 有 colgroup+table-layout:fixed**？
// 直接对比实验：新建一个最小 PM 编辑器外挂一个相同结构的表格在 body，
// 无任何装饰 —— 如果能点，则问题100%在 DocumentEditor 的层结构；
// 如果不能点，则是 PM 表格本身与 Chromium 的交互问题。
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(500)
// 不打开文档 —— 在空白 App 上用 JS 注入一个原生 table 到 body，点击
await p.evaluate(() => {
  document.body.innerHTML = '<table border="1" style="position:fixed;left:300px;top:300px;z-index:99999;background:#fff"><tr><td style="width:120px;height:60px">原生TD</td></tr></table>'
  window.__orig = []
  window.addEventListener('pointerdown', e => window.__orig.push(e.target.tagName), true)
})
await p.mouse.click(360, 330)
await p.waitForTimeout(200)
console.log('plain table on blank page →', JSON.stringify(await p.evaluate(() => window.__orig)))
await b.close()
