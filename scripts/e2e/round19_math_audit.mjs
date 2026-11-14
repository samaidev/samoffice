// round19: 朱东山 docx 全公式截图审计 + .doc 表格边框截图
// 用法: node scripts/e2e/round19_math_audit.mjs
import { chromium } from 'playwright'
import { writeFileSync } from 'fs'
import { join } from 'path'

const SHOTS = join(process.cwd(), 'scripts/e2e/round19-shots')
import { mkdirSync } from 'fs'
mkdirSync(SHOTS, { recursive: true })

const DOC1 = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const DOC2 = '/home/z/my-project/upload/中国区域碳排放影响因素研究20160509.doc'

async function openDoc(page, path, name) {
  const fs = await import('fs')
  const buf = fs.readFileSync(path)
  const form = new FormData()
  form.append('file', new Blob([buf]), name)
  const r = await fetch('http://localhost:18400/api/doc/open', { method: 'POST', body: form })
  const j = await r.json()
  if (!j.document) throw new Error('open failed: ' + JSON.stringify(j).slice(0, 200))
  return j.document
}

async function main() {
  const browser = await chromium.launch({ args: ['--no-sandbox'] })
  const page = await (await browser.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message))

  await page.goto('http://localhost:18400', { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.setItem('samoffice_theme', 'light'))
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)

  // ===== 文档一：朱东山 docx，逐公式审计 =====
  const doc1 = await openDoc(page, DOC1, 'contract.docx')
  await page.evaluate(d => window.__setDocForTest(d), doc1)
  await page.waitForTimeout(2500)

  const audit = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('.sam-math'))
    return els.map((e, i) => {
      const r = e.getBoundingClientRect()
      return {
        i,
        hasKatex: !!e.querySelector('.katex'),
        hasError: !!e.querySelector('.katex-error') || e.textContent.includes('ParseError'),
        // 占位符残留 / 裸 LaTeX 命令泄漏到文本
        rawLeak: /\\[a-zA-Z]+/.test(e.textContent) && !e.querySelector('.katex'),
        text: (e.textContent || '').replace(/\s+/g, ' ').slice(0, 80),
        top: Math.round(r.top + window.scrollY),
        h: Math.round(r.height),
      }
    })
  })
  console.log('公式总数:', audit.length)
  const bad = audit.filter(a => !a.hasKatex || a.hasError || a.rawLeak)
  console.log('问题公式:', bad.length, JSON.stringify(bad, null, 1).slice(0, 1500))
  writeFileSync(join(SHOTS, 'math-audit.json'), JSON.stringify(audit, null, 2))

  // 全文滚动截图（每屏存一张，直到超过最后一个公式）
  const maxTop = Math.max(...audit.map(a => a.top), 0)
  const screens = Math.min(Math.ceil(maxTop / 850) + 1, 14)
  for (let s = 0; s < screens; s++) {
    await page.evaluate(y => window.scrollTo(0, y), s * 850)
    await page.waitForTimeout(350)
    await page.screenshot({ path: join(SHOTS, `doc1-p${String(s).padStart(2, '0')}.png`) })
  }
  console.log('doc1 screens:', screens)

  await browser.close()
  console.log('pageerrors:', errors.slice(0, 3))
}
main().catch(e => { console.error('ERR:', e); process.exit(1) })
