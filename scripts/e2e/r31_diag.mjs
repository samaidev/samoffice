// round31 诊断②③：打印预览表格对齐 + 分页（文字落在页间空白）
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
await p.waitForTimeout(7000)

// ---------- 分页诊断：页间空白里是否有文字 ----------
const pg = await p.evaluate(() => {
  const pm = document.querySelector('.ProseMirror')
  // 纸页背景层
  const sheets = [...document.querySelectorAll('[data-page-idx], .paper-sheet, .doc-sheet')].map(s => { const r = s.getBoundingClientRect(); return { cls: s.className.slice(0, 30), top: Math.round(r.top), h: Math.round(r.height) } })
  // pm 内分页装饰
  const brks = [...pm.querySelectorAll('.pg-brk, .pg-linebreak')].map(e => ({ cls: e.className.slice(0, 20), mt: e.style.marginTop }))
  // 找「内容区底边以下、下一页顶边以上」的文字：
  // 简化：所有文本节点中心是否落在纸页范围外
  const txtOut = []
  const walker = document.createTreeWalker(pm, NodeFilter.SHOW_TEXT)
  let n
  while ((n = walker.nextNode())) {
    const t = (n.textContent || '').trim()
    if (!t) continue
    const rg = document.createRange(); rg.selectNodeContents(n)
    const r = rg.getBoundingClientRect()
    if (r.height > 0 && r.width > 0) txtOut.push({ t: t.slice(0, 15), top: Math.round(r.top), bottom: Math.round(r.bottom) })
  }
  return { sheets: sheets.slice(0, 6), brkCount: brks.length, brkSample: brks.slice(0, 4), textNodes: txtOut.length }
})
console.log('分页诊断:', JSON.stringify(pg, null, 1))

// 纸页矩形与文字的对齐关系：用编辑器滚动容器坐标
const geom = await p.evaluate(() => {
  const scroll = document.querySelector('.editor-scroll, .overflow-auto')
  const pm = document.querySelector('.ProseMirror')
  // 页背景元素（找绘制的纸页层）
  const layers = [...document.querySelectorAll('div')].filter(d => String(d.className) && /sheet|paper|page-bg/.test(String(d.className).toString()) && d.getBoundingClientRect().height > 500)
  const pmr = pm.getBoundingClientRect()
  return {
    scrollCls: scroll?.className?.slice(0, 40),
    layerCount: layers.length,
    layers: layers.slice(0, 5).map(l => { const r = l.getBoundingClientRect(); return { cls: String(l.className).slice(0, 40), top: Math.round(r.top - pmr.top), h: Math.round(r.height) } }),
    pmH: Math.round(pmr.height),
  }
})
console.log('纸页层:', JSON.stringify(geom, null, 1))
await b.close()
console.log('DONE')
