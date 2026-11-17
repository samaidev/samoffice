// round31 综合验证：①表格点击光标定位 ②批注锚点可见 ③预览表格对齐 ④分页稳定
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 150)))
p.setDefaultTimeout(30000)
await p.goto(BASE + '/?r=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(2000)
await p.evaluate(async () => {
  const r = await fetch('/test31.docx')
  const buf = await r.arrayBuffer()
  const file = new File([buf], 'test31.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
  const dt = new DataTransfer()
  dt.items.add(file)
  document.querySelector('#root > div').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
})
await p.waitForTimeout(8000)

// ---------- ①表格点击光标定位 ----------
// 滚到表格（表 1 在文档中部），点击某单元格中部文字中间
const tblInfo = await p.evaluate(() => {
  const pm = document.querySelector('.ProseMirror')
  const tbl = pm.querySelector('table')
  if (!tbl) return null
  // 找文字最长的单元格（验证 caret 能落在文字中间）
  let best = null
  tbl.querySelectorAll('tr').forEach((tr, ri) => {
    tr.querySelectorAll('td,th').forEach((td, ci) => {
      const txt = (td.textContent || '').trim()
      if (txt.length > 6 && (!best || txt.length > best.txt.length)) {
        const r = td.getBoundingClientRect()
        best = { x: Math.round(r.x + r.width * 0.7), y: Math.round(r.y + Math.min(r.height * 0.5, 30)), txt: txt.slice(0, 30), len: txt.length, ri, ci }
      }
    })
  })
  return best
})
console.log('目标单元格:', JSON.stringify(tblInfo))
if (tblInfo) {
  // 滚动表格进入视口（文档很长，表格在 9823px 处 —— 视口外点击无效）
  await p.evaluate(() => { document.querySelector('.ProseMirror table')?.scrollIntoView({ block: 'center' }) })
  await p.waitForTimeout(900)
  // 滚动后重新取坐标
  const ti2 = await p.evaluate((rc) => {
    const pm = document.querySelector('.ProseMirror')
    const tbl = pm.querySelector('table')
    const td = tbl.querySelectorAll('tr')[rc.ri]?.querySelectorAll('td,th')[rc.ci]
    if (!td) return null
    const r = td.getBoundingClientRect()
    return { x: Math.round(r.x + r.width * 0.7), y: Math.round(r.y + Math.min(r.height * 0.5, 30)) }
  }, { ri: tblInfo.ri, ci: tblInfo.ci })
  console.log('滚动后 ti2:', JSON.stringify(ti2))
  if (ti2) Object.assign(tblInfo, ti2)
  await p.mouse.click(tblInfo.x, tblInfo.y)
  await p.waitForTimeout(800)
  const caret = await p.evaluate(() => {
    const sel = window.getSelection()
    if (!sel || !sel.rangeCount) return null
    const r = sel.getRangeAt(0)
    const off = r.startOffset
    const nodeTxt = r.startContainer.textContent || ''
    return { offset: off, nodeText: nodeTxt.slice(0, 20), textBefore: nodeTxt.slice(Math.max(0, off - 6), off), textAt: nodeTxt.slice(off, off + 6) }
  })
  console.log('点击后光标:', JSON.stringify(caret))
  // 判定：光标 offset 应 > 0（不在首字前）—— 点击的是单元格中部
  const pass1 = caret && caret.offset > 0
  console.log(`① 点击光标定位: ${pass1 ? '✓ 光标在 offset=' + caret.offset + '（' + caret.textBefore + '|' + caret.textAt + '）' : '✗ 仍在首字前 offset=' + (caret?.offset ?? 'null')}`)
}

// ---------- ②批注锚点可见 ----------
const cm = await p.evaluate(() => {
  const marks = [...document.querySelectorAll('.comment-mark')]
  const first = marks[0]
  return {
    count: marks.length,
    firstW: first ? Math.round(first.getBoundingClientRect().width * 10) / 10 : 0,
    firstVisible: first ? first.offsetWidth > 0 && first.offsetHeight > 0 : false,
    paneCards: document.querySelectorAll('.comment-card').length,
  }
})
console.log(`② 批注: 锚点 ${cm.count} 个，首个宽 ${cm.firstW}px ${cm.firstW > 3 ? '✓可见' : '✗不可见'}；面板卡片 ${cm.paneCards} ${cm.paneCards === 11 ? '✓' : '✗'}`)

// ---------- ③打印预览表格对齐 ----------
await p.evaluate(() => { document.querySelector('[data-testid=word-print-btn]')?.click() })
await p.waitForTimeout(1800)
const pv = await p.evaluate(() => {
  const scope = [...document.querySelectorAll('div')].filter(d => d.getBoundingClientRect().width > 300 && d.querySelector('table'))
  const host = scope[scope.length - 1]
  if (!host) return { err: 'no preview' }
  const t = host.querySelector('table')
  const r = t.getBoundingClientRect()
  const paper = t.closest('div')?.parentElement
  const pr = paper?.getBoundingClientRect()
  const align = t.getAttribute('data-align')
  const ml = t.style.marginLeft, mr = t.style.marginRight
  return { tblLeft: Math.round(r.left), tblW: Math.round(r.width), paperLeft: pr ? Math.round(pr.left) : null, paperW: pr ? Math.round(pr.width) : null, align, ml, mr }
})
console.log('③ 预览表格:', JSON.stringify(pv))
// 本文档表格 100% 宽 → 应与纸同宽（视觉居中）
const pass3 = pv.paperW && pv.tblW >= pv.paperW - 4 && Math.abs(pv.tblLeft - pv.paperLeft) <= 4
console.log(`   预览表格对齐: ${pass3 ? '✓ 满宽居中（与纸同起点同宽）' : '✗'}`)
await p.keyboard.press('Escape')
await p.waitForTimeout(600)

// ---------- ④分页稳定（打开即扫描） ----------
const pg = await p.evaluate(() => {
  const pm = document.querySelector('.ProseMirror')
  const pmr = pm.getBoundingClientRect()
  const papers = [...document.querySelectorAll('.pg-paper')].map(el => { const r = el.getBoundingClientRect(); return { top: r.top - pmr.top, bottom: r.bottom - pmr.top } })
  const walker = document.createTreeWalker(pm, NodeFilter.SHOW_TEXT)
  let n, bad = 0
  while ((n = walker.nextNode())) {
    const t = (n.textContent || '').trim()
    if (!t) continue
    const rg = document.createRange(); rg.selectNodeContents(n)
    for (const r of rg.getClientRects()) {
      if (r.height <= 1 || r.width <= 1) continue
      const top = r.top - pmr.top, bottom = r.bottom - pmr.top
      if (!papers.some(pp => top >= pp.top - 6 && bottom <= pp.bottom + 6)) bad++
    }
  }
  return { papers: papers.length, bad }
})
console.log(`④ 分页: ${pg.papers} 张纸，落页间空白文字 ${pg.bad} 条 ${pg.bad === 0 ? '✓' : '✗'}`)

await p.screenshot({ path: '/tmp/r31_final_edit.png' })
await b.close()
console.log('ALL DONE')
