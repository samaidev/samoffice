// 脚注验证：构造含脚注的 .docx（后端打开），验证上标样式 + 双击编辑弹窗
import { chromium } from 'playwright'

// 用 Go 侧已有的 .docx 测试资产或现场构造 —— 用 API 打开一个带脚注的最小 docx
// 没有现成文件 → 直接在前端 PM 文档里插入 footnote 引用节点验证渲染与编辑
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(20000)
const errs = []
p.on('pageerror', e => errs.push(e.message.slice(0, 100)))
await p.goto('http://localhost:18400', { waitUntil: 'networkidle' })
await p.evaluate(() => localStorage.setItem('samoffice_theme', 'light'))
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
// 新建空文档
await p.evaluate(() => {
  const empty = { meta: { title: 't' }, blocks: [{ style: '正文', inline: [{ content: '正文文字内容测试脚注' }] }] }
  window.__setDocForTest(empty)
})
await p.waitForTimeout(2500)

// 插入 footnote 引用 + footnote_section
await p.evaluate(() => {
  const pm = window.__pmView
  const schema = pm.state.schema
  // 在第一段文字后插入 footnote
  const fn = schema.nodes.footnote.create({ num: 1, content: '测试脚注内容一' })
  pm.dispatch(pm.state.tr.insert(7, fn))
  // 追加 footnote_section 到文档末尾
  const item = schema.nodes.footnote_item.create({ num: 1 }, schema.text('测试脚注内容一'))
  const sec = schema.nodes.footnote_section.create({}, [item])
  pm.dispatch(pm.state.tr.insert(pm.state.doc.content.size, sec))
})
await p.waitForTimeout(1000)
// 1) 上标样式验证
const sup = await p.evaluate(() => {
  const pm = window.__pmView
  let pos = -1
  pm.state.doc.descendants((n, p2) => { if (pos < 0 && n.type.name === 'footnote') pos = p2; return pos < 0 })
  const el = pm.nodeDOM(pos)
  const s = getComputedStyle(el)
  return { tag: el.tagName, va: s.verticalAlign, text: el.textContent, fs: s.fontSize }
})
const supOk = sup.tag === 'SUP' && sup.va === 'super' && sup.text === '1'
console.log('1) 引用上标: tag=' + sup.tag + ' va=' + sup.va + ' text="' + sup.text + '"', supOk ? 'PASS' : 'FAIL')

// 2) 页面底部脚注区显示
const fdata = await p.evaluate(() => {
  // footnotesByPage 渲染的页底区
  const els = document.querySelectorAll('.pg-paper')
  const last = els[els.length - 1]
  const item = last?.querySelector('.footnote-item, [style*="border-top"]')
  return { pages: els.length, hasFootnoteArea: !!item, text: last?.textContent?.includes('测试脚注内容一') }
})
console.log('2) 页底脚注区: pages=' + fdata.pages + ' 显示脚注=' + fdata.text, fdata.text ? 'PASS' : 'FAIL')

// 3) 双击脚注 → 弹窗编辑
const dblRes = await p.evaluate(() => {
  const els = document.querySelectorAll('[title*="编辑脚注"], [title*="双击"]')
  // 找页底脚注文本元素
  const papers = document.querySelectorAll('.pg-paper')
  for (const pp of papers) {
    const divs = pp.querySelectorAll('div')
    for (const d of divs) {
      const t2 = d.getAttribute('title') || ''
      if (t2.includes('编辑脚注') || t2.includes('Edit footnote') || t2.toLowerCase().includes('footnote')) {
        if (d.textContent?.includes('测试脚注内容')) {
          d.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
          return { found: true }
        }
      }
    }
  }
  return { found: false }
})
await p.waitForTimeout(600)
const modal = await p.evaluate(() => !!document.querySelector('.modal textarea'))
console.log('3) 双击编辑弹窗: dbl=' + dblRes.found + ' modal=' + modal, (dblRes.found && modal) ? 'PASS' : 'FAIL')
// 4) 弹窗中改文本保存
if (modal) {
  const ta = await p.$('.modal textarea')
  await ta.fill('修改后的脚注内容')
  await p.waitForTimeout(300)
  await p.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('.modal button'))
    const ok = btns.find(b => b.textContent?.includes('确定') || b.textContent?.includes('OK'))
    ok?.click()
  })
  await p.waitForTimeout(600)
  const saved = await p.evaluate(() => {
    const pm = window.__pmView
    let text = ''
    pm.state.doc.descendants(n => { if (!text && n.type.name === 'footnote_item') text = n.textContent; return !text })
    return text
  })
  console.log('4) 编辑保存: "' + saved + '"', saved.includes('修改后') ? 'PASS' : 'FAIL')
}
console.log('errors:', errs.slice(0, 3))
await b.close()
