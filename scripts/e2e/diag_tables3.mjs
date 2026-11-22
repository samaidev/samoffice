// diag_tables3.mjs — Word 表格三问题复现
// T1: 插入表格是 prompt()（应改为 MS Word 网格选择器）
// T2: 选中行 → 点边框按钮 → CellSelection 是否丢失
// T3: 合并/拆分单元格是否产生错乱的表格结构
import { chromium } from 'playwright'

const OFFICE = 'http://localhost:18400'
const results = []
const ok = (name, pass, info = '') => { results.push([name, !!pass, info]); console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${info}`) }

async function newDocWithTable(p) {
  await p.locator('[data-testid="menu-files"]').click(); await p.waitForTimeout(400)
  await p.locator('text=📝').first().click(); await p.waitForTimeout(1200)
  // 通过 __setDocForTest 造一个 4x4 表格文档（绕过 prompt UI —— 结构控制）
  await p.evaluate(() => {
    // UDM: 表格 4x4，每个格子有文本（inline 格式，与 convert.ts cellToPM 兼容）
    const table = {
      type: 'table',
      rows: [0, 1, 2, 3].map(r => [0, 1, 2, 3].map(c => ({
        inline: [{ content: `c${r}${c}` }], isHeader: r === 0
      })))
    }
    const doc = { meta: { title: 'table-test' }, blocks: [table] }
    window.__setDocForTest(doc)
  })
  await p.waitForTimeout(1500)
}

async function main() {
  const b = await chromium.launch({ args: ['--no-sandbox'] })
  const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
  const dialogs = []
  p.on('dialog', async d => { dialogs.push({ type: d.type(), text: d.message().slice(0, 40) }); await d.accept('2') })
  await p.goto(OFFICE, { waitUntil: 'networkidle', timeout: 30000 })
  await p.waitForTimeout(1500)
  await p.evaluate(() => { localStorage.setItem('samoffice_lang', 'zh') })
  await p.reload({ waitUntil: 'networkidle' })
  await p.waitForTimeout(1200)

  // ═══ T1: 插入表格 —— round52 后应为网格选择器（无 prompt 弹窗） ═══
  await p.locator('[data-testid="menu-files"]').click(); await p.waitForTimeout(400)
  await p.locator('text=📝').first().click(); await p.waitForTimeout(1200)
  // 切到插入 ribbon
  await p.locator('button').filter({ hasText: '插入' }).first().click(); await p.waitForTimeout(400)
  const tblBtn = p.locator('button').filter({ hasText: '表格' }).first()
  const btnCount = await tblBtn.count()
  if (btnCount > 0) {
    await tblBtn.click(); await p.waitForTimeout(600)
    // round52 修复断言：无 prompt 弹窗，出现网格选择器
    ok('T1 修复：无 prompt 弹窗', dialogs.length === 0, JSON.stringify(dialogs.map(d => d.text)))
    const gridCells = await p.locator('.grid > div[style*="cursor: pointer"]').count()
    ok('T1 修复：网格选择器出现（10x8）', gridCells === 80, `cells=${gridCells}`)
    if (gridCells > 0) {
      // 悬停到第 3 行第 4 列 → 文字显示 3 x 4
      await p.locator('.grid > div[style*="cursor: pointer"]').nth((2) * 8 + 3).hover()
      await p.waitForTimeout(300)
      const caption = await p.evaluate(() => {
        const pop = document.querySelector('.animate-fade-in .text-xs.text-center')
        return pop?.textContent || ''
      })
      ok('T1 修复：悬停预览 3 × 4', caption.includes('3') && caption.includes('4'), `"${caption}"`)
      // 点击 → 插入 3x4 表格
      await p.locator('.grid > div[style*="cursor: pointer"]').nth((2) * 8 + 3).click()
      await p.waitForTimeout(800)
      const tblShape = await p.evaluate(() => {
        const v = window.__pmView
        let shape = null
        v.state.doc.descendants(node => {
          if (!shape && node.type.name === 'table') shape = { rows: node.childCount, cols: node.child(0).childCount }
        })
        return shape
      })
      ok('T1 修复：插入 3x4 表格', tblShape && tblShape.rows === 3 && tblShape.cols === 4, JSON.stringify(tblShape))
    }
  } else {
    ok('T1 找到插入表格按钮', false, 'button not found')
  }

  // ═══ T2: 边框按钮丢焦点 ═══
  await newDocWithTable(p)
  // 三击第一行首格 → CellSelection（引擎 handleTripleClick 同源）；更稳的做法：
  // 用 __pmView 直接构造 rowSelection
  const selInfo = await p.evaluate(() => {
    const v = window.__pmView
    if (!v) return { err: 'no view' }
    // 找第一行第一格 cell pos
    let cellPos = -1
    v.state.doc.descendants((node, pos) => {
      if (cellPos < 0 && node.type.name === 'table_cell') cellPos = pos
    })
    const $cell = v.state.doc.resolve(cellPos)
    const CellSelection = v.state.selection.constructor // 不能这么拿 —— 用 window 上暴露的？
    return { cellPos, hasView: true }
  })
  console.log('selInfo:', JSON.stringify(selInfo))

  // 用 window.__pmView 构造整行 CellSelection（需要 CellSelection 类 —— 检查全局是否可拿）
  const rowSelOk = await p.evaluate(() => {
    const v = window.__pmView
    if (!v) return false
    try {
      // 从 prosemirror-tables 全局? —— 编译打包后无全局。改从 DOM 路线：
      // 点第一行的行号区？DocumentEditor 的行选择是 mousedown 在 row handle。
      // 更直接：调用 DocumentEditor 内部注册的选择逻辑不可行。
      // 换个思路：双击选中单元格文字后 —— 不对，要 CellSelection。
      // 用脚本派发 mousedown 在表格第一行 + 拖到行尾（跨格拖选 → CellSelection，bridge 的引擎算法）
      return 'need-mouse-drag'
    } catch { return false }
  })
  // 鼠标拖选第一行（bridge 跨格拖选算法 → CellSelection row）
  const tr0 = await p.locator('.tableWrapper table tr').first().boundingBox()
  if (tr0) {
    // 从第一格中心拖到本行末格中心
    const tds = await p.locator('.tableWrapper table tr').first().locator('td,th').all()
    const first = await tds[0].boundingBox()
    const last = await tds[tds.length - 1].boundingBox()
    await p.mouse.move(first.x + 5, first.y + first.height / 2)
    await p.mouse.down()
    await p.mouse.move(last.x + last.width - 5, last.y + last.height / 2, { steps: 8 })
    await p.mouse.up()
    await p.waitForTimeout(400)
  }
  const cellSel1 = await p.evaluate(() => {
    const v = window.__pmView
    const s = v?.state?.selection
    return { isCell: !!(s && s.$anchorCell && s.$headCell) }
  })
  ok('T2 前置：拖选出整行 CellSelection', cellSel1.isCell === true, JSON.stringify(cellSel1))

  if (cellSel1.isCell) {
    // 现在点表格工具栏的边框按钮（▦）
    const borderBtn = p.locator('button[title="边框"], button[title*="框线"]').first()
    const bbCount = await borderBtn.count()
    if (bbCount === 0) {
      // title 是 t('doc.tblBorders') 默认'边框' —— 尝试按图标找
      const iconBtn = p.locator('div').filter({ hasText: /边框/ }).locator('button').first()
      console.log('按文本找边框按钮…')
    }
    await borderBtn.click().catch(async e => {
      console.log('点击失败，尝试 title 匹配:', e.message.slice(0, 60))
    })
    await p.waitForTimeout(400)
    // 点击后 CellSelection 是否还在？
    const cellSel2 = await p.evaluate(() => {
      const v = window.__pmView
      const s = v?.state?.selection
      return { isCell: !!(s && s.$anchorCell && s.$headCell), menuOpen: !!document.querySelector('.fixed.inset-0') }
    })
    ok('T2 复现：点边框按钮后 CellSelection 保留', cellSel2.isCell === true, JSON.stringify(cellSel2))

    // 菜单开了的话，点一个预设（所有框线），看选区是否还在 + 边框是否应用
    if (cellSel2.menuOpen || cellSel2.isCell) {
      const presetBtn = p.locator('button').filter({ hasText: '所有框线' }).first()
      if (await presetBtn.count() > 0) {
        await presetBtn.click(); await p.waitForTimeout(500)
        const cellSel3 = await p.evaluate(() => {
          const v = window.__pmView
          const s = v?.state?.selection
          // 检查第一行格子的 borders attr
          let borders = null
          v.state.doc.descendants((node, pos) => {
            if (borders === null && node.type.name === 'table_cell') borders = node.attrs.borders
          })
          return { isCell: !!(s && s.$anchorCell && s.$headCell), firstCellBorders: borders }
        })
        ok('T2 复现：点预设后选区保留+边框应用', cellSel3.isCell === true && cellSel3.firstCellBorders === '1111',
          JSON.stringify(cellSel3))
      }
    }
  }

  // ═══ T3: 合并/拆分错乱 ═══
  await newDocWithTable(p)
  // 拖选 2x2 区域（第一行第一格 → 第二行第二格）
  const rows = await p.locator('.tableWrapper table tr').all()
  const c00 = await rows[0].locator('td,th').first().boundingBox()
  const c11 = await rows[1].locator('td,th').nth(1).boundingBox()
  await p.mouse.move(c00.x + 5, c00.y + c00.height / 2)
  await p.mouse.down()
  await p.mouse.move(c11.x + c11.width - 5, c11.y + c11.height / 2, { steps: 8 })
  await p.mouse.up()
  await p.waitForTimeout(400)
  const sel22 = await p.evaluate(() => {
    const s = window.__pmView?.state?.selection
    return !!(s && s.$anchorCell && s.$headCell)
  })
  ok('T3 前置：拖选出 2x2 CellSelection', sel22 === true, `sel=${sel22}`)

  if (sel22) {
    // 点合并按钮 ⊟
    const mergeBtn = p.locator('button').filter({ hasText: '⊟' }).first()
    await mergeBtn.click(); await p.waitForTimeout(600)
    // 读合并后的表格结构
    const merged = await p.evaluate(() => {
      const v = window.__pmView
      const out = []
      v.state.doc.descendants(node => { if (node.type.name === 'table') out.push(JSON.parse(JSON.stringify(tableShape(node)))) })
      function tableShape(t) {
        return { rows: t.childCount, rowCells: Array.from({ length: t.childCount }, (_, r) => t.child(r).childCount) }
      }
      return out[0] || null
    })
    // 4x4 合并 2x2 → 第一行应 3 格（1 合并格 colspan2 + 2 常规），第二行 3 格
    // 注：合并 2x2 后文档模型 [3,2,4,4] 是正确的（第一行 3 物理格含 colspan2 合并格，
    // 第二行 2 物理格 —— rowspan 覆盖列不需要物理格，HTML 表格标准模型）
    ok('T3 合并后结构合理（4x4 合 2x2）', !!merged &&
      merged.rowCells[0] === 3 && merged.rowCells[1] === 2 && merged.rowCells[2] === 4 && merged.rows === 4,
      JSON.stringify(merged))

    // 再看合并格的 rowspan/colspan
    const spanInfo = await p.evaluate(() => {
      const v = window.__pmView
      let info = null
      v.state.doc.descendants(node => {
        if (!info && node.type.name === 'table_cell' && (node.attrs.rowspan > 1 || node.attrs.colspan > 1)) {
          info = { rowspan: node.attrs.rowspan, colspan: node.attrs.colspan, text: node.textContent.slice(0, 20) }
        }
      })
      return info
    })
    ok('T3 合并格 span = 2x2 且内容拼接', spanInfo && spanInfo.rowspan === 2 && spanInfo.colspan === 2,
      JSON.stringify(spanInfo))

    // 现在光标放合并格，点拆分 ⊞
    // 先三击合并格选中（CellSelection 单格）→ splitCell 需要 $from 在格内 —— 直接点格子放 caret
    const mergedTd = await p.evaluate(() => {
      const v = window.__pmView
      let pos = -1
      v.state.doc.descendants((node, p) => {
        if (pos < 0 && node.type.name === 'table_cell' && (node.attrs.rowspan > 1 || node.attrs.colspan > 1)) pos = p
      })
      return pos
    })
    // 放 caret 进合并格（dispatch TextSelection）
    await p.evaluate((pos) => {
      const v = window.__pmView
      const TextSelection = v.state.tr.selection.constructor // TextSelection 类
      v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.near(v.state.doc.resolve(pos + 2))))
    }, mergedTd)
    await p.waitForTimeout(300)
    const splitBtn = p.locator('button').filter({ hasText: '⊞' }).first()
    await splitBtn.click(); await p.waitForTimeout(600)
    const splitShape = await p.evaluate(() => {
      const v = window.__pmView
      let shape = null
      v.state.doc.descendants(node => {
        if (!shape && node.type.name === 'table') {
          shape = { rows: node.childCount, rowCells: Array.from({ length: node.childCount }, (_, r) => node.child(r).childCount) }
        }
      })
      // 任何残留的 span>1 格
      const spans = []
      v.state.doc.descendants(node => {
        if (node.type.name === 'table_cell' && ((node.attrs.rowspan || 1) > 1 || (node.attrs.colspan || 1) > 1)) spans.push({ rs: node.attrs.rowspan, cs: node.attrs.colspan })
      })
      return { shape, remainingSpans: spans }
    })
    // 拆分后应回到 4x4：rowCells = [4,4,4,4]，且无残留 span
    ok('T3 拆分后回到 4x4 且无残留', splitShape.shape && splitShape.shape.rowCells.join(',') === '4,4,4,4' && splitShape.remainingSpans.length === 0,
      JSON.stringify(splitShape))
  }

  await b.close()
  console.log('\n===== 汇总 =====')
  for (const [n, pass, i] of results) console.log(`${pass ? '✓' : '✗'} ${n} — ${i}`)
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
