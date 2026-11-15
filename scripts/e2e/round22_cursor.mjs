// round22: 复现"正文点击无光标"—— 用真实鼠标点击文档正文多个位置
import { chromium } from 'playwright'
import fs from 'fs'
import { join } from 'path'

const SHOTS = join(process.cwd(), 'scripts/e2e/round19-shots')
fs.mkdirSync(SHOTS, { recursive: true })
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'

const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(25000)
const errs = []
p.on('pageerror', e => errs.push(e.message.slice(0, 150)))
p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 120)) })
await p.goto('http://localhost:18400', { waitUntil: 'networkidle' })
await p.evaluate(() => localStorage.setItem('samoffice_theme', 'light'))
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
const buf = fs.readFileSync(DOC)
const form = new FormData()
form.append('file', new Blob([buf]), 'contract.docx')
const r = await fetch('http://localhost:18400/api/doc/open', { method: 'POST', body: form })
const j = await r.json()
console.log('解析警告:', (j.warnings || []).slice(0, 3))
await p.evaluate(d => window.__setDocForTest(d), j.document)
await p.waitForTimeout(3500)

// 文档结构体检：第一页有多少可点击段落
const struct = await p.evaluate(() => {
  const pm = window.__pmView
  const doc = pm.state.doc
  let paras = 0, texts = 0, empty = 0, firstText = ''
  doc.descendants((n) => {
    if (n.type.name === 'paragraph') {
      paras++
      if (n.textContent.trim()) { if (!firstText) firstText = n.textContent.slice(0, 20); texts++ }
      else empty++
    }
    return true
  })
  return { totalBlocks: doc.content.childCount, paras, texts, empty, firstText, editable: pm.editable, hasFocus: pm.hasFocus() }
})
console.log('文档结构:', JSON.stringify(struct))

// ===== 真实鼠标点击正文（多个位置）=====
const clickPoints = await p.evaluate(() => {
  const pm = window.__pmView
  // 找第一段有文本的段落，取其 DOM rect
  let target = null
  pm.state.doc.descendants((n, pos) => {
    if (target) return false
    if (n.type.name === 'paragraph' && n.textContent.trim().length > 3) {
      try {
        const el = pm.nodeDOM(pos)
        if (el && el.getBoundingClientRect) {
          const r = el.getBoundingClientRect()
          if (r.height > 5) target = { pos, x: r.x + 40, y: r.y + r.height / 2, text: n.textContent.slice(0, 16) }
        }
      } catch {}
    }
    return !target
  })
  return target
})
console.log('点击目标:', JSON.stringify(clickPoints))

if (clickPoints) {
  // 鼠标移入 + 点击
  await p.mouse.move(clickPoints.x, clickPoints.y)
  await p.waitForTimeout(200)
  await p.mouse.down()
  await p.waitForTimeout(80)
  await p.mouse.up()
  await p.waitForTimeout(600)
  const after1 = await p.evaluate(() => {
    const pm = window.__pmView
    const sel = pm.state.selection
    return { empty: sel.empty, from: sel.from, hasFocus: pm.hasFocus(), editable: pm.editable, cursorEl: !!document.querySelector('.ProseMirror-caret, .caret') }
  })
  console.log('单击后光标状态:', JSON.stringify(after1), after1.empty && after1.hasFocus ? 'FAIL（光标折叠且无输入位置）' : after1.hasFocus ? 'PASS' : 'FAIL 无焦点')

  // 双击（选词）也应工作
  await p.mouse.dblclick(clickPoints.x, clickPoints.y)
  await p.waitForTimeout(400)
  const after2 = await p.evaluate(() => {
    const sel = window.__pmView.state.selection
    return { empty: sel.empty, from: sel.from, to: sel.to }
  })
  console.log('双击选词:', JSON.stringify(after2), after2.empty ? 'FAIL（未选中词语）' : 'PASS')

  // 直接输入测试（点击后打字是否落字）
  await p.mouse.click(clickPoints.x, clickPoints.y)
  await p.waitForTimeout(300)
  const before = await p.evaluate(() => window.__pmView.state.doc.textContent.length)
  await p.keyboard.type('A', { delay: 40 })
  await p.waitForTimeout(400)
  const after = await p.evaluate(() => window.__pmView.state.doc.textContent.length)
  console.log('点击后输入: len', before, '→', after, after > before ? 'PASS 输入生效' : 'FAIL 输入无效')

  await p.screenshot({ path: join(SHOTS, 'round22-cursor-state.png') })
} else {
  console.log('没有找到可点击段落！检查文档渲染')
  await p.screenshot({ path: join(SHOTS, 'round22-cursor-state.png') })
}
console.log('errors:', errs.slice(0, 4))
await b.close()
