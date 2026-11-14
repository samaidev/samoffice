// round21: 格式刷 + 输入格式跟随 复现脚本
import { chromium } from 'playwright'
import fs from 'fs'

const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'

async function main() {
  const b = await chromium.launch({ args: ['--no-sandbox'], headless: true })
  const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
  p.setDefaultTimeout(20000)
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
  await p.waitForTimeout(2500)

  // ===== 测试 1: 格式刷（选中有格式的文本 → 点格式刷 → 选目标文本）=====
  // 用 PM API 构造场景：给第一段前 5 个字加粗，然后选中后 5 个字
  const setup = await p.evaluate(() => {
    const pm = window.__pmView
    const doc = pm.state.doc
    // 找第一段文本范围
    let pFrom = -1, pTo = -1, pText = ''
    doc.descendants((node, pos) => {
      if (pFrom < 0 && node.isText && node.text && node.text.trim().length > 8) {
        pFrom = pos; pTo = pos + node.nodeSize; pText = node.text
      }
      return pFrom < 0
    })
    if (pFrom < 0) return { ok: false }
    // 前 5 字加粗
    const bold = pm.state.schema.marks.bold
    pm.dispatch(pm.state.tr.addMark(pFrom, pFrom + 5, bold.create()))
    return { ok: true, pFrom, pTo, pText: pText.slice(0, 12) }
  })
  console.log('场景构造:', JSON.stringify(setup))
  if (!setup.ok) { await b.close(); return }

  // 模拟用户操作：选中前 5 字（粗体源）→ 点击格式刷按钮 → 选中后面的字
  await p.evaluate(s => {
    const pm = window.__pmView
    const TextSel = pm.state.selection.constructor
    pm.dispatch(pm.state.tr.setSelection(TextSel.create(pm.state.doc, s.pFrom, s.pFrom + 5)))
  }, setup)
  await p.waitForTimeout(200)
  // 点击格式刷按钮（ribbon 上的 title 含"格式刷"）
  const btn = await p.$('button[title*="格式刷"], button[title*="Format Painter"], button[title*="formatPainter"]')
  if (!btn) { console.log('未找到格式刷按钮，找 icon 🖌:'); }
  const btn2 = btn || await p.$('button:has(span:text-is("🖌"))')
  if (btn2) {
    await btn2.click()
    await p.waitForTimeout(400) // 等 220ms 单击定时器
    // 检查 painter 状态 —— 无法直接读 React state，通过按钮 active 样式判断
    const active = await btn2.evaluate(el => el.style.background !== 'transparent' && el.style.background !== '')
    console.log('点击格式刷后按钮高亮:', active)
    // 选中后 5 字
    await p.evaluate(s => {
      const pm = window.__pmView
      const TextSel = pm.state.selection.constructor
      pm.dispatch(pm.state.tr.setSelection(TextSel.create(pm.state.doc, s.pFrom + 8, s.pFrom + 13)))
    }, setup)
    await p.waitForTimeout(600) // appendTransaction 触发
    const targetMarks = await p.evaluate(s => {
      const pm = window.__pmView
      const node = pm.state.doc.nodeAt(s.pFrom + 10)
      return { marks: (node?.marks || []).map(m => m.type.name), hasBold: (node?.marks || []).some(m => m.type.name === 'bold') }
    }, setup)
    console.log('格式刷结果:', JSON.stringify(targetMarks), targetMarks.hasBold ? 'PASS' : 'FAIL（格式未套用）')
  } else {
    console.log('格式刷按钮不存在')
  }

  // ===== 测试 2: 输入继承前文格式 =====
  const typeTest = await p.evaluate(() => {
    const pm = window.__pmView
    // 光标放在加粗文本末尾（pFrom+5 处）
    let pFrom = -1
    pm.state.doc.descendants((node, pos) => {
      if (pFrom < 0 && node.isText && (node.marks || []).some(m => m.type.name === 'bold')) pFrom = pos
      return pFrom < 0
    })
    if (pFrom < 0) return { ok: false }
    const TextSel = pm.state.selection.constructor
    // 光标放在粗体段落的末尾（粗体文本结束处）
    const $p = pm.state.doc.resolve(pFrom)
    const paraEnd = $p.end()
    pm.dispatch(pm.state.tr.setSelection(TextSel.create(pm.state.doc, paraEnd - 1)))
    pm.focus()
    return { ok: true, cursorAt: paraEnd - 1 }
  })
  console.log('输入测试光标:', JSON.stringify(typeTest))
  await p.keyboard.type('NEW', { delay: 30 })
  await p.waitForTimeout(400)
  const newMarks = await p.evaluate(() => {
    const pm = window.__pmView
    // 找 NEW 文本的 marks
    let found = null
    pm.state.doc.descendants((node, pos) => {
      if (found) return false
      if (node.isText && node.text?.includes('NEW')) {
        found = { marks: node.marks.map(m => m.type.name), bold: node.marks.some(m => m.type.name === 'bold') }
      }
      return true
    })
    return found
  })
  console.log('输入 NEW 的 marks:', JSON.stringify(newMarks), newMarks?.bold ? 'PASS（继承粗体）' : 'FAIL（未继承）')
  console.log('errors:', errs.slice(0, 3))
  await b.close()
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1) })
