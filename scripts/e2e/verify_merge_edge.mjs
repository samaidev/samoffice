// verify_merge_edge.mjs — 合并/拆分边角用例
// E1: 仅横向合并（1x2 → colspan2）
// E2: 仅纵向合并（2x1 → rowspan2）
// E3: 合并后再合并相邻格（级联合并）
// E4: 框选含多个合并格 → 一次性全拆
// E5: 表头行合并格 + 边框应用共存
import { chromium } from 'playwright'

const OFFICE = 'http://localhost:18400'
const results = []
const ok = (name, pass, info = '') => { results.push([name, !!pass, info]); console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${info}`) }

async function setup(p) {
  await p.locator('[data-testid="menu-files"]').click(); await p.waitForTimeout(400)
  await p.locator('text=📝').first().click(); await p.waitForTimeout(1000)
  await p.evaluate(() => {
    const table = { type: 'table', rows: [0, 1, 2, 3].map(r => [0, 1, 2, 3].map(c => ({ inline: [{ content: 'c' + r + c }], isHeader: r === 0 }))) }
    window.__setDocForTest({ meta: { title: 't' }, blocks: [table] })
  })
  await p.waitForTimeout(1500)
}

async function dragCells(p, r1, c1, r2, c2) {
  const rows = await p.locator('.tableWrapper table tr').all()
  const a = await rows[r1].locator('td,th').nth(c1).boundingBox()
  const b = await rows[r2].locator('td,th').nth(c2).boundingBox()
  await p.mouse.move(a.x + 5, a.y + a.height / 2)
  await p.mouse.down()
  await p.mouse.move(b.x + b.width - 5, b.y + b.height / 2, { steps: 8 })
  await p.mouse.up()
  await p.waitForTimeout(400)
}

async function getDocShape(p) {
  return await p.evaluate(() => {
    const v = window.__pmView
    let shape = null, spans = []
    v.state.doc.descendants(node => {
      if (!shape && node.type.name === 'table') {
        shape = { rows: node.childCount, rowCells: Array.from({ length: node.childCount }, (_, r) => node.child(r).childCount) }
      }
      if (node.type.name === 'table_cell' && ((node.attrs.rowspan || 1) > 1 || (node.attrs.colspan || 1) > 1)) {
        spans.push({ rs: node.attrs.rowspan, cs: node.attrs.colspan, text: node.textContent })
      }
    })
    return { shape, spans }
  })
}

async function main() {
  const b = await chromium.launch({ args: ['--no-sandbox'] })
  const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
  await p.goto(OFFICE, { waitUntil: 'networkidle', timeout: 30000 })
  await p.waitForTimeout(1500)
  await p.evaluate(() => { localStorage.setItem('samoffice_lang', 'zh') })
  await p.reload({ waitUntil: 'networkidle' })
  await p.waitForTimeout(1200)

  // ═══ E1: 横向合并 ═══
  await setup(p)
  await dragCells(p, 0, 0, 0, 1)
  await p.locator('button').filter({ hasText: '⊟' }).first().click(); await p.waitForTimeout(600)
  let s = await getDocShape(p)
  ok('E1 横向合并：1x2 格', s.spans.length === 1 && s.spans[0].rs === 1 && s.spans[0].cs === 2 && s.spans[0].text === 'c00c01',
    JSON.stringify(s.spans))
  // 拆回
  await dragCells(p, 0, 0, 0, 0)
  await p.locator('button').filter({ hasText: '⊞' }).first().click(); await p.waitForTimeout(600)
  s = await getDocShape(p)
  ok('E1 拆回：无残留 span', s.spans.length === 0 && s.shape.rowCells.join(',') === '4,4,4,4', JSON.stringify(s.shape))

  // ═══ E2: 纵向合并 ═══
  await setup(p)
  await dragCells(p, 0, 0, 1, 0)
  await p.locator('button').filter({ hasText: '⊟' }).first().click(); await p.waitForTimeout(600)
  s = await getDocShape(p)
  ok('E2 纵向合并：2x1 格', s.spans.length === 1 && s.spans[0].rs === 2 && s.spans[0].cs === 1 && s.spans[0].text === 'c00c10',
    JSON.stringify(s.spans))
  await dragCells(p, 0, 0, 0, 0)
  await p.locator('button').filter({ hasText: '⊞' }).first().click(); await p.waitForTimeout(600)
  s = await getDocShape(p)
  ok('E2 拆回：无残留', s.spans.length === 0 && s.shape.rowCells.join(',') === '4,4,4,4', JSON.stringify(s.shape))

  // ═══ E3: 级联合并（先 2x2，再与右侧格合并成 2x3） ═══
  await setup(p)
  await dragCells(p, 0, 0, 1, 1)
  await p.locator('button').filter({ hasText: '⊟' }).first().click(); await p.waitForTimeout(600)
  // 合并 2x2 后：行0 物理格 = [merged(跨2列), c02, c03]；行1 物理格 = [c12, c13]
  // 级联合并：从合并格(行0格0)拖到 c13（行1格1）→ 覆盖网格列 0-2 → 2x3
  await dragCells(p, 0, 0, 1, 1)
  await p.locator('button').filter({ hasText: '⊟' }).first().click(); await p.waitForTimeout(600)
  s = await getDocShape(p)
  // 拖到行1最后物理格 = 网格列 3 → 合并矩形 2 行 x 4 列（正确语义）
  ok('E3 级联合并：2x4 格（行结构 [1,0,4,4]，空行保留）', s.spans.length === 1 && s.spans[0].rs === 2 && s.spans[0].cs === 4,
    JSON.stringify(s.spans) + ' shape=' + JSON.stringify(s.shape))
  await p.locator('button').filter({ hasText: '⊞' }).first().click(); await p.waitForTimeout(600)
  s = await getDocShape(p)
  ok('E3 单击拆分（caret 在合并格）回到 4x4', s.spans.length === 0 && s.shape.rowCells.join(',') === '4,4,4,4', JSON.stringify(s.shape))

  // ═══ E4: 框选含多个合并格 → 一次全拆 ═══
  await setup(p)
  await dragCells(p, 0, 0, 0, 1)  // 合并 A：横向
  await p.locator('button').filter({ hasText: '⊟' }).first().click(); await p.waitForTimeout(500)
  await dragCells(p, 1, 2, 2, 3)  // 合并 B：2x2
  await p.locator('button').filter({ hasText: '⊟' }).first().click(); await p.waitForTimeout(500)
  s = await getDocShape(p)
  ok('E4 前置：两个独立合并格', s.spans.length === 2, JSON.stringify(s.spans))
  // 框选整个表格（0,0 → 3,3）→ 拆分应全部还原
  await dragCells(p, 0, 0, 3, 3)
  await p.locator('button').filter({ hasText: '⊞' }).first().click(); await p.waitForTimeout(600)
  s = await getDocShape(p)
  ok('E4 框选全表一次拆分', s.spans.length === 0 && s.shape.rowCells.join(',') === '4,4,4,4', JSON.stringify(s.shape))

  // ═══ E5: 合并格 + 边框共存 ═══
  await setup(p)
  await dragCells(p, 0, 0, 1, 1)
  await p.locator('button').filter({ hasText: '⊟' }).first().click(); await p.waitForTimeout(500)
  // 选区还在（合并后 replaceTable 放了 caret）→ 框选全表 → 无框线 → 再读
  await dragCells(p, 0, 0, 3, 3)
  await p.locator('button[title="边框"], button[title*="框"]').first().click(); await p.waitForTimeout(400)
  await p.locator('button').filter({ hasText: '无框线' }).first().click(); await p.waitForTimeout(500)
  const noneBorders = await p.evaluate(() => {
    const v = window.__pmView
    const encs = []
    v.state.doc.descendants(node => { if (node.type.name === 'table_cell') encs.push(node.attrs.borders) })
    return { allNone: encs.length > 0 && encs.every(e => e === '0000'), count: encs.length }
  })
  ok('E5 合并格+全表无框线', noneBorders.allNone === true, JSON.stringify(noneBorders))
  await p.screenshot({ path: '/home/z/my-project/samoffice/scripts/e2e/round52-shots/edge-cases.png' })

  await b.close()
  console.log('\n===== 汇总 =====')
  for (const [n, pass, i] of results) console.log(`${pass ? '✓' : '✗'} ${n} — ${i}`)
  const fails = results.filter(r => !r[1]).length
  console.log(fails === 0 ? 'ALL PASS' : `${fails} FAIL`)
  process.exit(fails === 0 ? 0 : 1)
}

main().catch(e => { console.error(e); process.exit(1) })
