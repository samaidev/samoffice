// verify3.mjs — round51 三问题修复的最终验证（异步时序正确版）
// P1: 标签拖拽排序（dragstart → flush → dragover/drop，带插入侧断言）
// P2: 行列标头边框颜色为 --color-heading-border（#b4c0cf），且表格四角不裁边
// P3: 打印预览应用单元格真实样式（bold/颜色/填充/边框/合并）
import { chromium } from 'playwright'

const OFFICE = 'http://localhost:18400'
const results = []
const ok = (name, pass, info = '') => { results.push([name, !!pass, info]); console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${info}`) }

const fireDrag = (el, type, x, y, extra = {}) => {
  const e = new DragEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y })
  Object.defineProperty(e, 'dataTransfer', { value: { dropEffect: '', effectAllowed: 'move', setData() {}, files: [], ...extra } })
  el.dispatchEvent(e)
  return e
}

async function main() {
  const b = await chromium.launch({ args: ['--no-sandbox'] })
  const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
  await p.goto(OFFICE, { waitUntil: 'networkidle', timeout: 30000 })
  await p.waitForTimeout(1500)
  await p.evaluate(() => { localStorage.setItem('samoffice_lang', 'zh') })
  await p.reload({ waitUntil: 'networkidle' })
  await p.waitForTimeout(1200)

  // ═══ P1：三标签，document 拖到 slide 右半（after），再拖回 spreadsheet 左半（before）═══
  for (const [icon] of [['📝'], ['📊'], ['📽']]) {
    await p.locator('[data-testid="menu-files"]').click(); await p.waitForTimeout(400)
    await p.locator(`text=${icon}`).first().click(); await p.waitForTimeout(600)
  }
  const order0 = await p.evaluate(() => Array.from(document.querySelectorAll('[data-testid^="tab-"]')).map(e => e.dataset.testid).filter(x => x !== 'tab-about'))
  ok('P1 初始顺序', JSON.stringify(order0) === JSON.stringify(['tab-document', 'tab-spreadsheet', 'tab-slide']), JSON.stringify(order0))

  // 拖 document → slide 右半
  await p.evaluate(() => {
    const src = document.querySelector('[data-testid="tab-document"]')
    const r = src.getBoundingClientRect()
    fireDrag(src, 'dragstart', r.x + r.width / 2, r.y + 4)
    function fireDrag(el, type, x, y) {
      const e = new DragEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y })
      Object.defineProperty(e, 'dataTransfer', { value: { dropEffect: '', effectAllowed: 'move', setData() {}, files: [] } })
      el.dispatchEvent(e)
    }
  })
  await p.waitForTimeout(250)
  await p.evaluate(() => {
    const dst = document.querySelector('[data-testid="tab-slide"]')
    const r = dst.getBoundingClientRect()
    const mk = (type) => {
      const e = new DragEvent(type, { bubbles: true, cancelable: true, clientX: r.x + r.width * 0.75, clientY: r.y + 4 })
      Object.defineProperty(e, 'dataTransfer', { value: { dropEffect: '', effectAllowed: 'move', setData() {}, files: [] } })
      dst.dispatchEvent(e)
    }
    mk('dragover'); mk('drop')
  })
  await p.waitForTimeout(400)
  const order1 = await p.evaluate(() => Array.from(document.querySelectorAll('[data-testid^="tab-"]')).map(e => e.dataset.testid).filter(x => x !== 'tab-about'))
  ok('P1 右半插入：document 移到末尾', JSON.stringify(order1) === JSON.stringify(['tab-spreadsheet', 'tab-slide', 'tab-document']), JSON.stringify(order1))

  // 拖 document → spreadsheet 左半（before）
  await p.evaluate(() => {
    const src = document.querySelector('[data-testid="tab-document"]')
    const mk = (el, type, x, y) => {
      const e = new DragEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y })
      Object.defineProperty(e, 'dataTransfer', { value: { dropEffect: '', effectAllowed: 'move', setData() {}, files: [] } })
      el.dispatchEvent(e)
    }
    const r = src.getBoundingClientRect()
    mk(src, 'dragstart', r.x + r.width / 2, r.y + 4)
  })
  await p.waitForTimeout(250)
  await p.evaluate(() => {
    const dst = document.querySelector('[data-testid="tab-spreadsheet"]')
    const r = dst.getBoundingClientRect()
    const mk = (type) => {
      const e = new DragEvent(type, { bubbles: true, cancelable: true, clientX: r.x + r.width * 0.25, clientY: r.y + 4 })
      Object.defineProperty(e, 'dataTransfer', { value: { dropEffect: '', effectAllowed: 'move', setData() {}, files: [] } })
      dst.dispatchEvent(e)
    }
    mk('dragover'); mk('drop')
  })
  await p.waitForTimeout(400)
  const order2 = await p.evaluate(() => Array.from(document.querySelectorAll('[data-testid^="tab-"]')).map(e => e.dataset.testid).filter(x => x !== 'tab-about'))
  ok('P1 左半插入：document 回到最前', JSON.stringify(order2) === JSON.stringify(['tab-document', 'tab-spreadsheet', 'tab-slide']), JSON.stringify(order2))

  // 插入指示线存在性（dragover 中检查）
  await p.evaluate(() => {
    const src = document.querySelector('[data-testid="tab-slide"]')
    const mk = (el, type, x, y) => {
      const e = new DragEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y })
      Object.defineProperty(e, 'dataTransfer', { value: { dropEffect: '', effectAllowed: 'move', setData() {}, files: [] } })
      el.dispatchEvent(e)
    }
    const r = src.getBoundingClientRect()
    mk(src, 'dragstart', r.x + r.width / 2, r.y + 4)
  })
  await p.waitForTimeout(250)
  const hasIndicator = await p.evaluate(() => {
    const dst = document.querySelector('[data-testid="tab-spreadsheet"]')
    const r = dst.getBoundingClientRect()
    const mk = (type) => {
      const e = new DragEvent(type, { bubbles: true, cancelable: true, clientX: r.x + r.width * 0.8, clientY: r.y + 4 })
      Object.defineProperty(e, 'dataTransfer', { value: { dropEffect: '', effectAllowed: 'move', setData() {}, files: [] } })
      dst.dispatchEvent(e)
    }
    mk('dragover')
    // dragover 后指示线应在 DOM 中
    const line = dst.querySelector('span.absolute.right-0')
    const cleanup = () => mk('dragend') || true
    window.__cleanupDrag = cleanup
    return !!line
  })
  // dragover 的 setState 需要一次 React 渲染后才出现在 DOM —— 上面同步查询拿不到，
  // 在这里（waitForTimeout 之后）真正断言
  const indicatorNow = await p.evaluate(() => !!document.querySelector('[data-testid="tab-spreadsheet"] span.absolute.right-0'))
  ok('P1 拖拽插入指示线渲染', indicatorNow === true, `indicator=${indicatorNow}`)
  await p.evaluate(() => { const s = document.querySelector('[data-testid="tab-slide"]'); const e = new DragEvent('dragend', { bubbles: true }); s.dispatchEvent(e) })
  await p.waitForTimeout(300)

  // ═══ P2：行列标头边框 ═══
  await p.locator('[data-testid="tab-spreadsheet"]').click()
  await p.waitForTimeout(800)
  const borderInfo = await p.evaluate(() => {
    const corner = document.querySelector('thead th')
    const cs = getComputedStyle(corner)
    const tbl = corner.closest('table')
    return { color: cs.borderTopColor, width: cs.borderTopWidth, tableOverflow: getComputedStyle(tbl).overflow, tableRadius: getComputedStyle(tbl).borderRadius }
  })
  ok('P2 标头边框加深为 heading-border', borderInfo.color === 'rgb(180, 192, 207)', JSON.stringify(borderInfo))
  ok('P2 表格不再裁边（overflow visible）', borderInfo.tableOverflow === 'visible', `overflow=${borderInfo.tableOverflow}`)

  // ═══ P3：打印预览样式 ═══
  await p.locator('td[data-cell="0-0"]').click()
  await p.keyboard.type('Header1'); await p.keyboard.press('Enter'); await p.waitForTimeout(200)
  await p.locator('td[data-cell="0-0"]').click(); await p.waitForTimeout(150)
  await p.keyboard.press('Escape'); await p.waitForTimeout(150)
  await p.keyboard.press('Control+b'); await p.waitForTimeout(200)
  await p.locator('td[data-cell="1-0"]').click()
  await p.keyboard.type('Data'); await p.keyboard.press('Enter'); await p.waitForTimeout(200)
  await p.locator('td[data-cell="1-0"]').click(); await p.waitForTimeout(150)
  await p.keyboard.press('Escape'); await p.waitForTimeout(150)
  await p.locator('button', { hasText: '▫细线' }).first().click(); await p.waitForTimeout(200)
  // 网格参照值
  const gridRef = await p.evaluate(() => {
    const s1 = document.querySelector('td[data-cell="0-0"] span.block')
    const t2 = document.querySelector('td[data-cell="1-0"]')
    return { a1fw: getComputedStyle(s1).fontWeight, a2border: getComputedStyle(t2).borderTopWidth + ' ' + getComputedStyle(t2).borderTopColor }
  })
  // 打开打印预览
  await p.locator('button', { hasText: '视图' }).first().click(); await p.waitForTimeout(300)
  await p.locator('[data-testid="excel-print-btn"]').click(); await p.waitForTimeout(900)
  await p.locator('[data-testid="print-dialog"]').screenshot({ path: '/home/z/my-project/samoffice/scripts/e2e/round51-shots/p3-fixed.png' })
  const pv = await p.evaluate(() => {
    const d = document.querySelector('[data-testid="print-dialog"]')
    const tds = Array.from(d.querySelectorAll('td'))
    const a1 = tds.find(td => td.textContent.includes('Header1'))
    const a2 = tds.find(td => td.textContent.includes('Data'))
    if (!a1 || !a2) return { found: false }
    const g1 = getComputedStyle(a1), g2 = getComputedStyle(a2)
    return { found: true, a1fw: g1.fontWeight, a1full: a1.textContent, a2border: g2.borderTopWidth + ' ' + g2.borderTopColor, headTh: d.querySelectorAll('thead th').length }
  })
  ok('P3 预览找到内容', pv.found === true, JSON.stringify(pv))
  if (pv.found) {
    ok('P3 加粗应用到预览', pv.a1fw === '700', `grid=${gridRef.a1fw} preview=${pv.a1fw}`)
    ok('P3 文本不再截断(10字限制移除)', pv.a1full === 'Header1', `text="${pv.a1full}"`)
    ok('P3 边框应用到预览', pv.a2border.startsWith('1px') && !pv.a2border.includes('226'), `grid=${gridRef.a2border} preview=${pv.a2border}`)
    ok('P3 行列标头不进打印页', (pv.headTh ?? 0) === 0, `thead th count=${pv.headTh}`)
  }
  await p.keyboard.press('Escape')
  await b.close()

  console.log('\n===== 汇总 =====')
  for (const [n, pass, i] of results) console.log(`${pass ? '✓' : '✗'} ${n} — ${i}`)
  const fails = results.filter(r => !r[1]).length
  console.log(fails === 0 ? 'ALL PASS' : `${fails} FAIL`)
  process.exit(fails === 0 ? 0 : 1)
}

main().catch(e => { console.error(e); process.exit(1) })
