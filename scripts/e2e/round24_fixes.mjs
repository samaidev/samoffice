// round24 E2E：验证三个用户报告的修复
//  1) 拼写检查默认不运行（打开/编辑公式文档无 spell-error 装饰），审阅页按钮手动触发后才出现
//  2) 打印预览真实分页：页码指示 N>1，◀/▶ 可用
//  3) 公式可点选（NodeSelection 高亮）且公式编辑器可选字号并生效
import { chromium } from 'playwright'
import fs from 'fs'

const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const BASE = 'http://127.0.0.1:18400'
const results = []
const ok = (name, cond, extra = '') => { results.push(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`) }

const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.evaluate(() => localStorage.setItem('samoffice_theme', 'light'))
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(1200)

// 打开公式文档
const buf = fs.readFileSync(DOC)
const form = new FormData()
form.append('file', new Blob([buf]), 'contract.docx')
const r = await fetch(BASE + '/api/doc/open', { method: 'POST', body: form })
const j = await r.json()
await p.evaluate(d => window.__setDocForTest(d), j.document)
await p.waitForTimeout(5000)

const mathCount = await p.locator('.sam-math').count()
ok('doc has formulas', mathCount > 0, `${mathCount} formulas`)

// === 1. 拼写检查默认不运行 ===
const spellDefault = await p.locator('.spell-error').count()
ok('no auto spell marks after open', spellDefault === 0, `${spellDefault} marks`)
await p.locator('.ProseMirror p').first().click()
await p.keyboard.type('xyzq ', { delay: 60 })
await p.waitForTimeout(2500)
const spellAfterType = await p.locator('.spell-error').count()
ok('no auto spell marks after typing', spellAfterType === 0, `${spellAfterType} marks`)

// 手动触发：切到审阅页，点"拼写"按钮
await p.getByRole('button', { name: /审阅|Review/ }).first().click()
await p.waitForTimeout(500)
const spellBtn = p.getByRole('button', { name: /拼写检查|拼写|Spelling/ }).first()
await spellBtn.click()
// 词典已在服务端预载（server 模式），检查应很快出现装饰；桌面版首次会慢些
let manualMarks = 0
try {
  await p.waitForFunction(() => document.querySelectorAll('.spell-error').length > 0, { timeout: 20000 })
  manualMarks = await p.locator('.spell-error').count()
} catch {}
ok('manual spell check runs', manualMarks > 0, `${manualMarks} marks after button click`)
// 编辑后结果失效（先点回正文获得焦点，避免键盘事件落在功能区按钮上）
await p.locator('.ProseMirror p').first().click()
await p.keyboard.type('abc', { delay: 60 })
await p.waitForTimeout(1500)
const afterEdit = await p.locator('.spell-error').count()
ok('marks cleared after edit', afterEdit === 0, `${afterEdit} marks`)

// === 3. 公式点选 + 字号 ===
const mathEl = p.locator('.sam-math').first()
await mathEl.scrollIntoViewIfNeeded()
const box = await mathEl.boundingBox()
await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
await p.waitForTimeout(400)
const selected = await p.evaluate(() => !!document.querySelector('.sam-math.sam-math-selected'))
ok('formula click selects (NodeSelection)', selected)
// 功能区字号 A+ 生效：记录当前字号 → 点字号+ → 字号 attr 变化
const beforeFs = await p.evaluate(() => document.querySelector('.sam-math').getAttribute('data-font-size') || '')
// 双击打开公式编辑器 → 选字号 28 → 插入
await p.locator('.sam-math').first().dblclick()
await p.waitForTimeout(800)
const modalVisible = await p.locator('[data-testid=math-font-size]').count()
ok('math modal opens with font-size select', modalVisible === 1)
await p.selectOption('[data-testid=math-font-size]', '28')
await p.waitForTimeout(300)
const previewFs = await p.evaluate(() => {
  // 预览容器内 fontSize=28px 且包含 .katex 渲染结果（不能查第一个 .katex ——
  // 文档里还有 25 个公式节点会干扰）
  const hit = [...document.querySelectorAll('div')].some(d => d.style.fontSize === '28px' && d.querySelector('.katex'))
  return hit ? '28px' : ''
})
ok('modal preview applies size', previewFs === '28px', previewFs)
await p.getByRole('button', { name: /插入公式/ }).click()
await p.waitForTimeout(1200)
const afterFs = await p.evaluate(() => {
  const el = document.querySelector('.sam-math')
  return { attr: el.getAttribute('data-font-size'), style: el.style.fontSize }
})
ok('formula font-size applied', afterFs.attr === '28' && afterFs.style === '28px', JSON.stringify(afterFs))

// === 回归：表格点击可编辑（round22 死区 — spell 触发链路改动的波及面） ===
const hasTable = await p.locator('.ProseMirror table').count()
if (hasTable > 0) {
  const tdEl = p.locator('.ProseMirror td').first()
  await tdEl.scrollIntoViewIfNeeded()
  const cb = await tdEl.boundingBox()
  await p.mouse.click(cb.x + Math.min(80, cb.width / 2), cb.y + cb.height / 2)
  await p.waitForTimeout(300)
  await p.keyboard.type('R24', { delay: 60 })
  await p.waitForTimeout(800)
  const cellNow = await p.evaluate(() => {
    for (const td of document.querySelectorAll('.ProseMirror td')) {
      if (td.textContent.includes('R24')) return true
    }
    return false
  })
  ok('table cell editable (round22 regression)', cellNow)
} else {
  ok('table found in doc', false, 'no table')
}

// === 2. 打印预览分页 ===
await p.evaluate(() => { document.activeElement?.blur?.() })
await p.getByRole('button', { name: /视图|View/ }).first().click().catch(() => {})
await p.waitForTimeout(400)
await p.locator('[data-testid=word-print-btn]').click()
await p.waitForTimeout(1500)
const indicator = await p.locator('[data-testid=print-page-indicator]').textContent().catch(() => '')
ok('preview shows real page count', /\d+ \/ \d+/.test(indicator || '') && !/^1 \/ 3$/.test(indicator || ''), indicator || '(none)')
const m = (indicator || '').match(/(\d+) \/ (\d+)/)
if (m && +m[2] > 1) {
  await p.locator('[data-testid=print-page-next]').click()
  await p.waitForTimeout(400)
  const ind2 = await p.locator('[data-testid=print-page-indicator]').textContent()
  ok('page next works', ind2.trim() === `2 / ${m[2]}`, ind2)
  await p.locator('[data-testid=print-page-prev]').click()
  await p.waitForTimeout(400)
  const ind3 = await p.locator('[data-testid=print-page-indicator]').textContent()
  ok('page prev works', ind3.trim() === `1 / ${m[2]}`, ind3)
} else {
  ok('multi-page document', false, `pageCount=${m ? m[2] : '?'}`)
}
try { await p.screenshot({ path: '/tmp/round24_print.png' }) } catch {}

console.log(results.join('\n'))
const fails = results.filter(r => r.startsWith('FAIL')).length
console.log(fails === 0 ? 'ALL-PASS' : `FAILED:${fails}`)
await b.close()
process.exit(fails === 0 ? 0 : 1)
