// round69 边框逐按钮验证 v2：__pmView 桥插入表格 + 真实 UI 边框菜单点击。
// 验证（对齐 MS Word 语义）：预设切换、内部边框、颜色、粗细，td 四边 computed style。
// 用例矩阵：
//   1-4  top/bottom/left/right 单边清除→恢复
//   5-6  innerH/innerV 内部线清除→恢复（外框不动）
//   7    inner 内部框线
//   8    outer 外侧框线
//   9-10 none / all 绝对设置
//   11   红色 + 3pt 应用
//   12   0.5pt
//   13   去边再恢复颜色不丢
import { chromium } from 'playwright'

const OFFICE = 'http://127.0.0.1:18400'
const results = []
const ok = (name, pass, info = '') => { results.push([name, !!pass, info]); console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${info}`) }

const dumpBorders = () => {
  // 只取真实可见表格（分页引擎的跨页克隆 wrapper 是 0×0 隐藏残留，边框状态滞后）
  const tds = [...document.querySelectorAll('.ProseMirror table')]
    .filter(t => { const r = t.getBoundingClientRect(); return r.width > 10 && r.height > 10 })
    .flatMap(t => [...t.querySelectorAll('td')])
  return tds.map(td => {
    const cs = getComputedStyle(td)
    const side = s => ({ s: cs['border' + s + 'Style'], w: cs['border' + s + 'Width'], c: cs['border' + s + 'Color'] })
    return { top: side('Top'), right: side('Right'), bottom: side('Bottom'), left: side('Left') }
  })
}

async function newDocWithTable(p) {
  const r = await p.evaluate(() => {
    const v = window.__pmView, s = v.state
    const P = s.schema.nodes.paragraph
    const rows = []
    for (let ri = 0; ri < 3; ri++) {
      const cells = []
      for (let ci = 0; ci < 3; ci++) cells.push(s.schema.nodes.table_cell.createAndFill(null, null, [P.createAndFill()]))
      rows.push(s.schema.nodes.table_row.createAndFill(null, cells))
    }
    v.dispatch(s.tr.replaceSelectionWith(s.schema.nodes.table.createAndFill(null, rows)))
    return 'OK'
  })
  return r
}

// 全选表格（CellSelection）—— 用 pmView 桥构造，模拟「表格全选」
async function selectWholeTable(p) {
  await p.evaluate(() => {
    const v = window.__pmView, s = v.state
    // 找表格位置
    let tablePos = -1
    s.doc.descendants((node, pos) => {
      if (tablePos < 0 && node.type.name === 'table') tablePos = pos
      return true
    })
    if (tablePos < 0) return 'NO_TABLE'
    // 手工设 TextSelection 到表格首个 cell 前角（CellSelection 构造依赖 prosemirror-tables 模块；
    // 改用 DOM 途径：点击首格 + shift 点击末格 由 Playwright 完成）
    return tablePos
  })
}

async function main() {
  const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
  p.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 120)))
  await p.goto(OFFICE, { waitUntil: 'networkidle', timeout: 30000 })
  await p.evaluate(() => { localStorage.setItem('samoffice_lang', 'zh') })
  await p.reload({ waitUntil: 'networkidle' })
  await p.waitForTimeout(1500)

  // 新建 Word + 插入 3×3 表格
  await p.locator('[data-testid="menu-files"]').click({ force: true }); await p.waitForTimeout(500)
  await p.locator('text=Word 文档').first().click({ force: true })
  await p.waitForTimeout(2500)
  ok('编辑器就绪', await p.locator('.ProseMirror').count() > 0)
  await newDocWithTable(p)
  await p.waitForTimeout(700)
  const hasTable = await p.locator('.ProseMirror table').count()
  ok('插入 3×3 表格', hasTable > 0)

  // 选中整个表格：强制显示左上角全选手柄（headless 无真实 hover），点击 = CellSelection 全表
  const shown = await p.evaluate(() => {
    const h = document.querySelector('.pm-table-handle')
    if (!h) return 'NOT_IN_DOM'
    h.classList.add('pm-shown')
    return 'SHOWN'
  })
  ok('全选手柄出现', shown === 'SHOWN')
  if (shown === 'SHOWN') {
    const hb = await p.locator('.pm-table-handle').first().boundingBox()
    await p.mouse.click(hb.x + hb.width / 2, hb.y + hb.height / 2)
    await p.waitForTimeout(500)
  }
  const selName = await p.evaluate(() => window.__pmView.state.selection.constructor.name)
  const selRanges = await p.evaluate(() => (window.__pmView.state.selection.ranges || []).length)
  ok('表格选区建立（CellSelection 全表）', selRanges === 9, `sel=${selName} ranges=${selRanges}`)
  // 表格工具栏渲染（React state 更新走 dispatchTransaction → setInTable）
  await p.waitForTimeout(1200)

  // 基线：全框线
  let snap = await p.evaluate(dumpBorders)
  const allSolid = snap.every(bd => ['top','right','bottom','left'].every(s => bd[s].s === 'solid'))
  ok('基线：默认全框线', allSolid, JSON.stringify(snap[0]).slice(0, 120))

  // 边框菜单操作函数
  const openBorderMenu = async () => {
    const btn = p.locator('button[title="边框"]').first()
    await btn.waitFor({ state: 'visible', timeout: 5000 })
    await btn.click({ force: true })
    await p.waitForTimeout(400)
  }
  const clickPreset = async (label) => {
    await openBorderMenu()
    const item = p.locator(`button:has-text("${label}")`).first()
    if (!(await item.count())) { await p.keyboard.press('Escape'); throw new Error(`找不到预设 ${label}`) }
    await item.click({ force: true })
    await p.waitForTimeout(600)
  }

  // ══ 1. 上框线 ══
  await clickPreset('上框线')
  snap = await p.evaluate(dumpBorders)
  ok('上框线：首行 top 清除', snap[0].top.s === 'none', JSON.stringify(snap[0].top))
  ok('上框线：第二行 top 保留', snap[3].top.s === 'solid', snap[3].top.s)
  ok('上框线：首行其余三边保留', snap[0].bottom.s === 'solid' && snap[0].left.s === 'solid' && snap[0].right.s === 'solid')
  await clickPreset('上框线')
  snap = await p.evaluate(dumpBorders)
  ok('上框线：再点恢复', snap[0].top.s === 'solid')

  // ══ 2. 下框线 ══
  await clickPreset('下框线')
  snap = await p.evaluate(dumpBorders)
  ok('下框线：末行 bottom 清除', snap[6].bottom.s === 'none', JSON.stringify(snap[6].bottom))
  await clickPreset('下框线')
  snap = await p.evaluate(dumpBorders)
  ok('下框线：再点恢复', snap[6].bottom.s === 'solid')

  // ══ 3. 左框线 ══
  await clickPreset('左框线')
  snap = await p.evaluate(dumpBorders)
  ok('左框线：首列 left 全清除', snap[0].left.s === 'none' && snap[3].left.s === 'none' && snap[6].left.s === 'none', `${snap[0].left.s},${snap[3].left.s},${snap[6].left.s}`)
  await clickPreset('左框线')
  snap = await p.evaluate(dumpBorders)
  ok('左框线：再点恢复', snap[0].left.s === 'solid')

  // ══ 4. 右框线 ══
  await clickPreset('右框线')
  snap = await p.evaluate(dumpBorders)
  ok('右框线：末列 right 全清除', snap[2].right.s === 'none' && snap[5].right.s === 'none' && snap[8].right.s === 'none', `${snap[2].right.s},${snap[5].right.s},${snap[8].right.s}`)
  await clickPreset('右框线')
  snap = await p.evaluate(dumpBorders)
  ok('右框线：再点恢复', snap[8].right.s === 'solid')

  // ══ 5. 内部横线 ══
  await clickPreset('内部横线')
  snap = await p.evaluate(dumpBorders)
  ok('内部横线：中间横线清除', snap[3].top.s === 'none' && snap[6].top.s === 'none', `${snap[3].top.s},${snap[6].top.s}`)
  ok('内部横线：外框保留', snap[0].top.s === 'solid' && snap[6].bottom.s === 'solid' && snap[0].left.s === 'solid' && snap[2].right.s === 'solid')
  await clickPreset('内部横线')
  snap = await p.evaluate(dumpBorders)
  ok('内部横线：再点恢复', snap[3].top.s === 'solid')

  // ══ 6. 内部竖线 ══
  await clickPreset('内部竖线')
  snap = await p.evaluate(dumpBorders)
  ok('内部竖线：中间竖线清除', snap[1].left.s === 'none' && snap[2].left.s === 'none', `${snap[1].left.s},${snap[2].left.s}`)
  ok('内部竖线：外框保留', snap[0].left.s === 'solid' && snap[2].right.s === 'solid' && snap[0].top.s === 'solid')
  await clickPreset('内部竖线')
  snap = await p.evaluate(dumpBorders)
  ok('内部竖线：再点恢复', snap[1].left.s === 'solid')

  // ══ 7. 内部框线 ══
  await clickPreset('内部框线')
  snap = await p.evaluate(dumpBorders)
  ok('内部框线：内部横竖全清', snap[3].top.s === 'none' && snap[1].left.s === 'none', `${snap[3].top.s},${snap[1].left.s}`)
  ok('内部框线：外框保留', snap[0].top.s === 'solid' && snap[0].left.s === 'solid' && snap[2].right.s === 'solid' && snap[6].bottom.s === 'solid')
  await clickPreset('内部框线')
  snap = await p.evaluate(dumpBorders)
  ok('内部框线：再点恢复', snap[3].top.s === 'solid' && snap[1].left.s === 'solid')

  // ══ 8. 外侧框线 ══
  await clickPreset('外侧框线')
  snap = await p.evaluate(dumpBorders)
  ok('外侧框线：四外边清除', snap[0].top.s === 'none' && snap[0].left.s === 'none' && snap[2].right.s === 'none' && snap[6].bottom.s === 'none', `t=${snap[0].top.s} l=${snap[0].left.s} r=${snap[2].right.s} b=${snap[6].bottom.s}`)
  ok('外侧框线：内部线保留', snap[3].top.s === 'solid' && snap[1].left.s === 'solid')
  await clickPreset('外侧框线')
  snap = await p.evaluate(dumpBorders)
  ok('外侧框线：再点恢复', snap[0].top.s === 'solid' && snap[2].right.s === 'solid')

  // ══ 9. 无框线 ══
  await clickPreset('无框线')
  snap = await p.evaluate(dumpBorders)
  ok('无框线：全部清除', snap.every(bd => ['top','right','bottom','left'].every(s => bd[s].s === 'none')))

  // ══ 10. 所有框线 ══
  await clickPreset('所有框线')
  snap = await p.evaluate(dumpBorders)
  ok('所有框线：全恢复', snap.every(bd => ['top','right','bottom','left'].every(s => bd[s].s === 'solid')))

  // ══ 11. 红色 + 3pt ══
  await openBorderMenu()
  await p.locator('input[type="color"]').first().fill('#ff0000')
  await p.waitForTimeout(300)
  await p.locator('select').last().selectOption('3')
  await p.waitForTimeout(300)
  await p.locator('button:has-text("所有框线")').first().click({ force: true })
  await p.waitForTimeout(600)
  snap = await p.evaluate(dumpBorders)
  ok('颜色：红色应用到所有边', snap.every(bd => ['top','right','bottom','left'].every(s => bd[s].c === 'rgb(255, 0, 0)')), JSON.stringify(snap[0].top))
  ok('粗细：3pt 应用', snap.every(bd => ['top','right','bottom','left'].every(s => parseFloat(bd[s].w) >= 3)), `w=${snap[0].top.w}`)

  // ══ 12. 0.5pt ══
  await openBorderMenu()
  await p.locator('select').last().selectOption('0.5')
  await p.locator('button:has-text("所有框线")').first().click({ force: true })
  await p.waitForTimeout(600)
  snap = await p.evaluate(dumpBorders)
  ok('粗细：0.5pt 应用（≤1px）', snap.every(bd => ['top','right','bottom','left'].every(s => parseFloat(bd[s].w) <= 1)), `w=${snap[0].top.w}`)

  // ══ 13. 切换不丢颜色 ══
  await openBorderMenu()
  await p.locator('select').last().selectOption('1')
  await p.locator('button:has-text("所有框线")').first().click({ force: true })
  await p.waitForTimeout(500)
  await clickPreset('右框线') // 去
  snap = await p.evaluate(dumpBorders)
  const rightOff = snap[8].right.s === 'none'
  await clickPreset('右框线') // 恢复
  snap = await p.evaluate(dumpBorders)
  ok('切换不丢颜色：去右框→恢复仍红色', rightOff && snap[8].right.s === 'solid' && snap[8].right.c === 'rgb(255, 0, 0)', JSON.stringify(snap[8].right))

  finish(b)
}

function finish(b) {
  const fails = results.filter(r => !r[1])
  console.log(`\n════ 总结: ${results.length - fails.length}/${results.length} PASS ════`)
  if (fails.length) { console.log('FAIL 项：'); fails.forEach(f => console.log('  -', f[0], '|', f[2])) }
  b.close()
}

main().catch(e => { console.error('FATAL', e.message); process.exit(1) })
