// round22: 有头模式事件派发链诊断 —— click 到达了吗？谁吃掉了？
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const b = await chromium.launch({ args: ['--no-sandbox'], headless: false })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(25000)
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
await p.waitForTimeout(3500)

// 1) 找第一个表格位置
const tbl = await p.evaluate(() => {
  const pm = window.__pmView
  let pos = -1
  pm.state.doc.descendants((n, p2) => { if (pos < 0 && n.type.name === 'table') pos = p2; return pos < 0 })
  if (pos < 0) return null
  const el = pm.nodeDOM(pos)
  const r2 = el.getBoundingClientRect()
  // 第一个单元格中心
  return { pos, x: r2.x + 60, y: r2.y + 20 }
})
console.log('表格点击点:', JSON.stringify(tbl))

if (tbl) {
  // 2) 挂事件探针：document 级 capture 监听所有 mousedown/click
  await p.evaluate(() => {
    window.__evts = []
    for (const type of ['mousedown', 'mouseup', 'click', 'pointerdown']) {
      document.addEventListener(type, (e) => {
        const t = e.target
        window.__evts.push(type + ' → ' + (t.tagName || '?') + '.' + String(t.className).slice(0, 30) + (t.isContentEditable ? '[CE]' : ''))
      }, true)
    }
  })
  await p.mouse.click(tbl.x, tbl.y)
  await p.waitForTimeout(600)
  const evts = await p.evaluate(() => window.__evts.slice())
  console.log('事件序列:', evts.length ? evts : '【零事件！原生事件完全没派发】')
  const focusState = await p.evaluate(() => {
    const pm = window.__pmView
    return { focus: pm.hasFocus(), sel: pm.state.selection.from, tag: document.activeElement?.tagName }
  })
  console.log('点击后:', JSON.stringify(focusState))
  // 3) elementFromPoint 对照（JS 层命中谁）
  const hit = await p.evaluate(t => {
    const el = document.elementFromPoint(t.x, t.y)
    return { tag: el?.tagName, cls: String(el?.className).slice(0, 40), ce: el?.isContentEditable }
  }, tbl)
  console.log('elementFromPoint:', JSON.stringify(hit), hit.ce ? '（JS 命中可编辑元素——纯原生事件问题）' : '')
  // 4) 合成层检查：哪些元素被提升
  const layers = await p.evaluate(() => {
    let count = 0
    const sample = []
    document.querySelectorAll('*').forEach(el => {
      const s = getComputedStyle(el)
      if (s.willChange !== 'auto' || s.transform !== 'none' || s.position === 'fixed') {
        count++
        if (sample.length < 6) sample.push(el.tagName + '.' + String(el.className).slice(0, 25) + ' wc=' + s.willChange + ' tf=' + s.transform.slice(0, 20))
      }
    })
    return { count, sample }
  })
  console.log('合成层候选:', JSON.stringify(layers))
  // 5) 表格上方/下方段落点击对照
  const para = await p.evaluate(() => {
    const pm = window.__pmView
    let target = null
    pm.state.doc.descendants((n, pos) => {
      if (target) return false
      if (n.type.name === 'paragraph' && n.textContent.trim().length > 6) {
        const el = pm.nodeDOM(pos)
        const r = el.getBoundingClientRect()
        if (r.y > 240 && r.height > 5) target = { x: r.x + 60, y: r.y + r.height / 2 }
      }
      return !target
    })
    return target
  })
  await p.evaluate(() => { window.__evts = [] })
  await p.mouse.click(para.x, para.y)
  await p.waitForTimeout(500)
  const evts2 = await p.evaluate(() => window.__evts.slice())
  const focus2 = await p.evaluate(() => window.__pmView.hasFocus())
  console.log('段落点击事件:', evts2.length ? evts2.slice(0, 3) : '零事件', 'focus=', focus2)
}
await b.close()
