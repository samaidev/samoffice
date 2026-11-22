// verify_merge_render.mjs — 合并 2x2 后的 DOM 渲染 + 布局校验
import { chromium } from 'playwright'

const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
await p.goto('http://localhost:18400', { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
await p.evaluate(() => { localStorage.setItem('samoffice_lang', 'zh') })
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
await p.locator('[data-testid="menu-files"]').click(); await p.waitForTimeout(400)
await p.locator('text=📝').first().click(); await p.waitForTimeout(1000)
await p.evaluate(() => {
  const table = { type: 'table', rows: [0, 1, 2, 3].map(r => [0, 1, 2, 3].map(c => ({ inline: [{ content: 'c' + r + c }], isHeader: r === 0 }))) }
  window.__setDocForTest({ meta: { title: 't' }, blocks: [table] })
})
await p.waitForTimeout(1500)
// 拖选 2x2 → 合并
const rows = await p.locator('.tableWrapper table tr').all()
const c00 = await rows[0].locator('td,th').first().boundingBox()
const c11 = await rows[1].locator('td,th').nth(1).boundingBox()
await p.mouse.move(c00.x + 5, c00.y + c00.height / 2)
await p.mouse.down()
await p.mouse.move(c11.x + c11.width - 5, c11.y + c11.height / 2, { steps: 8 })
await p.mouse.up()
await p.waitForTimeout(400)
await p.locator('button').filter({ hasText: '⊟' }).first().click()
await p.waitForTimeout(800)

const domShape = await p.evaluate(() => {
  const table = document.querySelector('.tableWrapper table')
  const trs = Array.from(table.querySelectorAll('tr'))
  return trs.map(tr => {
    const tds = Array.from(tr.children)
    return {
      cells: tds.length,
      spans: tds.map(td => td.rowSpan + 'x' + td.colSpan),
      texts: tds.map(td => td.textContent.slice(0, 6)),
    }
  })
})
console.log('DOM 渲染结构:')
domShape.forEach((r, i) => console.log('  行', i, ':', r.cells, '格', JSON.stringify(r.spans), JSON.stringify(r.texts)))

// 布局校验：第二行的可见格的 x 起点应有 3 个不同值（合并格在第二行继续占位）
const layout = await p.evaluate(() => {
  const tr2 = document.querySelectorAll('.tableWrapper table tr')[1]
  return Array.from(tr2.children).map(td => {
    const r = td.getBoundingClientRect()
    return { x: Math.round(r.x), w: Math.round(r.width), txt: td.textContent.slice(0, 4) }
  })
})
console.log('第二行布局:', JSON.stringify(layout))

// 第一行布局对照
const layout0 = await p.evaluate(() => {
  const tr1 = document.querySelectorAll('.tableWrapper table tr')[0]
  return Array.from(tr1.children).map(td => {
    const r = td.getBoundingClientRect()
    return { x: Math.round(r.x), w: Math.round(r.width), txt: td.textContent.slice(0, 4) }
  })
})
console.log('第一行布局:', JSON.stringify(layout0))
await p.screenshot({ path: '/home/z/my-project/samoffice/scripts/e2e/round52-shots/merged-2x2.png' })
await b.close()
