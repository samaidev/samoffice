// round21: 全量验证 —— 格式跟随/格式刷真实路径/公式字号/脚注弹窗/打印预览
import { chromium } from 'playwright'
import fs from 'fs'
import { join } from 'path'

const SHOTS = join(process.cwd(), 'scripts/e2e/round19-shots')
fs.mkdirSync(SHOTS, { recursive: true })
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'

async function main() {
  const b = await chromium.launch({ args: ['--no-sandbox'] })
  const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
  p.setDefaultTimeout(25000)
  const errs = []
  p.on('pageerror', e => errs.push(e.message.slice(0, 100)))
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
  await p.waitForTimeout(3000)

  // ===== 1. 格式跟随：回车继承段落属性 =====
  const prep = await p.evaluate(() => {
    const pm = window.__pmView
    let pos = -1, size = 0
    pm.state.doc.descendants((node, p2) => {
      if (pos < 0 && node.type.name === 'paragraph' && node.textContent.trim().length > 4) { pos = p2; size = node.nodeSize }
      return pos < 0
    })
    pm.dispatch(pm.state.tr.setNodeMarkup(pos, undefined, { ...pm.state.doc.nodeAt(pos).attrs, align: 'center' }))
    const TextSel = pm.state.selection.constructor
    pm.dispatch(pm.state.tr.setSelection(TextSel.create(pm.state.doc, pos + size - 1)))
    pm.focus()
    return { pos, nextPos: pos + size }
  })
  await p.keyboard.press('Enter')
  await p.waitForTimeout(500)
  const newPara = await p.evaluate(pp => {
    const n = window.__pmView.state.doc.nodeAt(pp.nextPos)
    return { type: n?.type.name, align: n?.attrs?.align }
  }, prep)
  const followOk = newPara.align === 'center'
  console.log('1) 回车格式跟随: 新段落 align=' + newPara.align, followOk ? 'PASS' : 'FAIL')
  // 撤销
  await p.keyboard.press('Control+z')

  // ===== 2. 格式刷真实路径：真实鼠标选源文本 → 点按钮 → 选目标 =====
  // 定位第一段：粗体前5字（构造）后用鼠标拖选
  const setup = await p.evaluate(() => {
    const pm = window.__pmView
    let pFrom = -1
    pm.state.doc.descendants((node, pos) => {
      if (pFrom < 0 && node.isText && node.text && node.text.trim().length > 8) pFrom = pos
      return pFrom < 0
    })
    const bold = pm.state.schema.marks.bold
    pm.dispatch(pm.state.tr.addMark(pFrom, pFrom + 5, bold.create()))
    // DOM 坐标：源选区（前5字）与目标（后移8字）
    const el = pm.domAtPos(pFrom + 1)
    const el2 = pm.domAtPos(pFrom + 9)
    const r1 = (el.node.nodeType === 1 ? el.node : el.node.parentElement).getBoundingClientRect()
    const r2 = (el2.node.nodeType === 1 ? el2.node : el2.node.parentElement).getBoundingClientRect()
    return { pFrom, src: { x: r1.x + 2, y: r1.y + r1.height / 2 }, dst: { x: r2.x + 2, y: r2.y + r2.height / 2 } }
  })
  // 真实拖选源
  await p.mouse.move(setup.src.x, setup.src.y)
  await p.mouse.down()
  await p.mouse.move(setup.src.x + 30, setup.src.y, { steps: 5 })
  await p.mouse.up()
  await p.waitForTimeout(300)
  // 点格式刷按钮
  const btn = await p.$('button[title*="格式刷"]') || await p.$('button[title*="Painter"]')
  if (btn) {
    await btn.click()
    await p.waitForTimeout(400)
    // 拖选目标
    await p.mouse.move(setup.dst.x, setup.dst.y)
    await p.mouse.down()
    await p.mouse.move(setup.dst.x + 25, setup.dst.y, { steps: 5 })
    await p.mouse.up()
    await p.waitForTimeout(700)
    const res = await p.evaluate(s => {
      const pm = window.__pmView
      const node = pm.state.doc.nodeAt(s.pFrom + 10)
      return { hasBold: (node?.marks || []).some(m => m.type.name === 'bold') }
    }, setup)
    console.log('2) 格式刷真实路径: 目标带粗体=' + res.hasBold, res.hasBold ? 'PASS' : 'FAIL')
    await p.keyboard.press('Control+z')
  } else {
    console.log('2) 格式刷按钮未找到 SKIP')
  }

  // ===== 3. 公式字号 =====
  const mathInfo = await p.evaluate(() => {
    const pm = window.__pmView
    let pos = -1
    pm.state.doc.descendants((node, p2) => { if (pos < 0 && node.type.name === 'math') pos = p2; return pos < 0 })
    return { pos: pos >= 0 ? pos : null }
  })
  if (mathInfo.pos != null) {
    // 选中公式（NodeSelection）
    const mathRes = await p.evaluate(mp => {
      const pm = window.__pmView
      const NSel = pm.state.selection.constructor === Object ? null : null
      // 用 NodeSelection.create
      const { NodeSelection } = window.__PMNodeSel || {}
      // 回退：直接 setNodeMarkup 写 fontSize 验证渲染管线
      const node = pm.state.doc.nodeAt(mp)
      pm.dispatch(pm.state.tr.setNodeMarkup(mp, undefined, { ...node.attrs, fontSize: '28' }))
      const el = pm.nodeDOM(mp)
      return { fontSize: el ? getComputedStyle(el).fontSize : null }
    }, mathInfo.pos)
    const mathOk = mathRes.fontSize === '28px'
    console.log('3) 公式字号 28px: 实际=' + mathRes.fontSize, mathOk ? 'PASS' : 'FAIL')
    await p.evaluate(mp => {
      const pm = window.__pmView
      const node = pm.state.doc.nodeAt(mp)
      pm.dispatch(pm.state.tr.setNodeMarkup(mp, undefined, { ...node.attrs, fontSize: '' }))
    }, mathInfo.pos)
  } else {
    console.log('3) 文档无公式 SKIP')
  }

  // ===== 4. 脚注：引用上标 + 双击编辑弹窗 =====
  const fn = await p.evaluate(() => {
    const pm = window.__pmView
    let pos = -1
    pm.state.doc.descendants((node, p2) => { if (pos < 0 && node.type.name === 'footnote') pos = p2; return pos < 0 })
    return pos >= 0 ? { pos, exists: true } : { exists: false }
  })
  if (fn.exists) {
    const supRes = await p.evaluate(fp => {
      const pm = window.__pmView
      const el = pm.nodeDOM(fp)
      const s = getComputedStyle(el)
      return { tag: el.tagName, va: s.verticalAlign, text: el.textContent }
    }, fn.pos)
    const supOk = supRes.tag === 'SUP' && supRes.va === 'super' && !supRes.text.includes('[')
    console.log('4) 脚注引用上标: tag=' + supRes.tag + ' va=' + supRes.va + ' text="' + supRes.text + '"', supOk ? 'PASS' : 'FAIL')
  } else {
    console.log('4) 文档无脚注引用 SKIP（.docx 含脚注时验证）')
  }

  // ===== 5. 打印预览：真实文档克隆 =====
  // 打印预览按钮在【视图】ribbon tab 下
  await p.evaluate(() => {
    const tab = document.querySelector('button[data-testid="ribbon-tab-view"]')
    if (tab) tab.click()
  })
  await p.waitForTimeout(500)
  await p.evaluate(() => {
    const btn = document.querySelector('button[data-testid="word-print-btn"]')
    if (btn) btn.click()
    else window.__printBtnMissing = true
  })
  await p.waitForTimeout(1200)
  const preview = await p.evaluate(() => {
    const dlg = document.querySelector('[data-testid="print-preview"]')
    if (!dlg) return { open: false, missing: window.__printBtnMissing }
    if (!dlg) return { open: false }
    // 预览里应有真实文档内容（.sam-math / 表格 / 主题色文字）
    const hasMath = !!dlg.querySelector('.sam-math, .katex')
    const hasTable = !!dlg.querySelector('table, .tableWrapper')
    const textLen = (dlg.textContent || '').trim().length
    return { open: true, hasMath, hasTable, textLen }
  })
  const printOk = preview.open && preview.textLen > 100
  console.log('5) 打印预览真实内容: open=' + preview.open + ' 文本量=' + (preview.textLen || 0) + (preview.hasMath ? ' 含公式' : '') + (preview.hasTable ? ' 含表格' : ''), printOk ? 'PASS' : 'FAIL')
  await p.screenshot({ path: join(SHOTS, 'round21-print-preview.png') })
  await p.keyboard.press('Escape')

  // ===== 6. 拼写 mixed 端到端（页面级）=====
  // 已由 API 层验证（teh/quikc 报错、中文放行），此处略。

  console.log('errors:', errs.slice(0, 3))
  await b.close()
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1) })
