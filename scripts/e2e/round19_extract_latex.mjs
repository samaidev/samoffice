// round19: 提取失败公式的原始 LaTeX（从 ProseMirror doc 属性，非 textContent 截断）
import { chromium } from 'playwright'

async function main() {
  const browser = await chromium.launch({ args: ['--no-sandbox'] })
  const page = await (await browser.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
  await page.goto('http://localhost:18400', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  const fs = await import('fs')
  const buf = fs.readFileSync('/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx')
  const form = new FormData()
  form.append('file', new Blob([buf]), 'contract.docx')
  const r = await fetch('http://localhost:18400/api/doc/open', { method: 'POST', body: form })
  const j = await r.json()
  await page.evaluate(d => window.__setDocForTest(d), j.document)
  await page.waitForTimeout(2500)
  const latex = await page.evaluate(() => {
    const pm = window.__pmView
    const out = []
    pm.state.doc.descendants(node => {
      if (node.type.name === 'math_inline' || node.type.name === 'math_block' || (node.attrs && node.attrs.latex !== undefined)) {
        out.push({ type: node.type.name, latex: node.attrs.latex })
      }
      return true
    })
    return out
  })
  // 只打印渲染失败的 4 个（依 audit：17,18,20,23）
  for (const i of [17, 18, 20, 23]) {
    console.log(`===== #${i} (${latex[i].type}) =====`)
    console.log(latex[i].latex)
    console.log()
  }
  await browser.close()
}
main().catch(e => { console.error('ERR:', e); process.exit(1) })
