// round70 边框逐按钮验证：__pmView 桥插入表格 + 真实 UI 边框菜单点击。
// round70 语义（用户主诉驱动）：预设 = 应用语义（确保参与边存在），
// 「无框线」清全部，「所有框线」全开。td 四边 computed style 断言。
// 用例矩阵：
//   1-4   top/bottom/left/right 单边预设：无框线状态点击 → 该边出现（外其余保持）
//   5-6   innerH/innerV：无框线状态点击 → 只出现内部横/竖线
//   7     inner：无框线→只内线；全框状态→内线保持（用户主诉①回归）
//   8     outer：无框线→只外框
//   9-10  none 清全部 / all 全开
//   11    10 轮 none→all 循环选区稳定性（压塌回归，快照恢复生效）
//   12    自绘色板选红色立即生效（用户主诉②）
//   13    色板 hex 输入自定义色生效
//   14    线宽输入 2.25pt 回车立即生效（用户主诉③）
//   15    快捷档位 3pt 点击立即生效
//   16    切换预设不丢颜色
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

// 简化快照：9 格四边 's'/'n' 串
const dumpSides = () => {
  const tds = [...document.querySelectorAll('.ProseMirror table')]
    .filter(t => { const r = t.getBoundingClientRect(); return r.width > 10 && r.height > 10 })
    .flatMap(t => [...t.querySelectorAll('td')])
  return tds.map(td => {
    const cs = getComputedStyle(td)
    return ['Top', 'Right', 'Bottom', 'Left'].map(s => cs['border' + s + 'Style'].slice(0, 1)).join('')
  })
}

async function newDocWithTable(p) {
  await p.evaluate(() => {
    const v = window.__pmView, s = v.state
    const P = s.schema.nodes.paragraph
    const rows = []
    for (let ri = 0; ri < 3; ri++) {
      const cells = []
      for (let ci = 0; ci < 3; ci++) cells.push(s.schema.nodes.table_cell.createAndFill(null, [P.createAndFill()]))
      rows.push(s.schema.nodes.table_row.createAndFill(null, cells))
    }
    v.dispatch(s.tr.replaceSelectionWith(s.schema.nodes.table.createAndFill(null, rows)))
    return 'OK'
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
  ok('插入 3×3 表格', await p.locator('.ProseMirror table').count() > 0)

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
  const selRanges = await p.evaluate(() => (window.__pmView.state.selection.ranges || []).length)
  ok('表格选区建立（CellSelection 全表）', selRanges === 9, `ranges=${selRanges}`)
  await p.waitForTimeout(1200)

  // 基线：全框线
  let snap = await p.evaluate(dumpBorders)
  ok('基线：默认全框线', snap.every(bd => ['top','right','bottom','left'].every(s => bd[s].s === 'solid')))

  // 边框菜单操作函数
  const openBorderMenu = async () => {
    // 菜单可能已开（前一步没关）：先检查预设按钮是否已可见，避免 toggle 关掉
    if (await p.locator('button:has-text("无框线")').first().isVisible().catch(() => false)) return
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

  // ══ 1. 上框线（应用语义：无框线状态点击 → 首行 top 出现，其余保持无）══
  await clickPreset('无框线')
  await clickPreset('上框线')
  snap = await p.evaluate(dumpBorders)
  ok('上框线：首行 top 开启', snap[0].top.s === 'solid' && snap[1].top.s === 'solid' && snap[2].top.s === 'solid', `${snap[0].top.s},${snap[1].top.s},${snap[2].top.s}`)
  ok('上框线：首行其余三边保持无', snap[0].bottom.s === 'none' && snap[0].left.s === 'none' && snap[0].right.s === 'none')
  ok('上框线：其余行 top 保持无', snap[3].top.s === 'none' && snap[6].top.s === 'none')

  // ══ 2. 下框线 ══
  await clickPreset('无框线')
  await clickPreset('下框线')
  snap = await p.evaluate(dumpBorders)
  ok('下框线：末行 bottom 开启', snap[6].bottom.s === 'solid' && snap[7].bottom.s === 'solid' && snap[8].bottom.s === 'solid', `${snap[6].bottom.s},${snap[7].bottom.s},${snap[8].bottom.s}`)
  ok('下框线：其余边保持无', snap[0].top.s === 'none' && snap[3].bottom.s === 'none')

  // ══ 3. 左框线 ══
  await clickPreset('无框线')
  await clickPreset('左框线')
  snap = await p.evaluate(dumpBorders)
  ok('左框线：首列 left 全开', snap[0].left.s === 'solid' && snap[3].left.s === 'solid' && snap[6].left.s === 'solid', `${snap[0].left.s},${snap[3].left.s},${snap[6].left.s}`)
  ok('左框线：其余保持无', snap[1].left.s === 'none' && snap[0].right.s === 'none')

  // ══ 4. 右框线 ══
  await clickPreset('无框线')
  await clickPreset('右框线')
  snap = await p.evaluate(dumpBorders)
  ok('右框线：末列 right 全开', snap[2].right.s === 'solid' && snap[5].right.s === 'solid' && snap[8].right.s === 'solid', `${snap[2].right.s},${snap[5].right.s},${snap[8].right.s}`)
  ok('右框线：其余保持无', snap[1].right.s === 'none' && snap[0].left.s === 'none')

  // ══ 5. 内部横线 ══
  await clickPreset('无框线')
  await clickPreset('内部横线')
  snap = await p.evaluate(dumpBorders)
  ok('内部横线：中间横线开启', snap[3].top.s === 'solid' && snap[6].top.s === 'solid', `${snap[3].top.s},${snap[6].top.s}`)
  ok('内部横线：外边缘保持无', snap[0].top.s === 'none' && snap[6].bottom.s === 'none' && snap[0].left.s === 'none' && snap[2].right.s === 'none')

  // ══ 6. 内部竖线 ══
  await clickPreset('无框线')
  await clickPreset('内部竖线')
  snap = await p.evaluate(dumpBorders)
  ok('内部竖线：中间竖线开启', snap[1].left.s === 'solid' && snap[2].left.s === 'solid', `${snap[1].left.s},${snap[2].left.s}`)
  ok('内部竖线：外边缘保持无', snap[0].left.s === 'none' && snap[2].right.s === 'none' && snap[0].top.s === 'none')

  // ══ 7. 内部框线（用户主诉①回归用例）══
  await clickPreset('无框线')
  await clickPreset('内部框线')
  snap = await p.evaluate(dumpBorders)
  ok('内部框线：内横竖线开启', snap[3].top.s === 'solid' && snap[1].left.s === 'solid' && snap[6].top.s === 'solid' && snap[5].left.s === 'solid', `${snap[3].top.s},${snap[1].left.s}`)
  ok('内部框线：外边缘保持无', snap[0].top.s === 'none' && snap[0].left.s === 'none' && snap[2].right.s === 'none' && snap[6].bottom.s === 'none')
  // 用户主诉场景：默认全框线表点「内部框线」→ 内线必须保持（不得清空）
  await clickPreset('所有框线')
  await clickPreset('内部框线')
  snap = await p.evaluate(dumpBorders)
  ok('内部框线：全框状态点击后内线保持开启（用户主诉①）', snap[3].top.s === 'solid' && snap[1].left.s === 'solid', `${snap[3].top.s},${snap[1].left.s}`)

  // ══ 8. 外侧框线 ══
  await clickPreset('无框线')
  await clickPreset('外侧框线')
  snap = await p.evaluate(dumpBorders)
  ok('外侧框线：四外边开启', snap[0].top.s === 'solid' && snap[0].left.s === 'solid' && snap[2].right.s === 'solid' && snap[6].bottom.s === 'solid', `t=${snap[0].top.s} l=${snap[0].left.s} r=${snap[2].right.s} b=${snap[6].bottom.s}`)
  ok('外侧框线：内部线保持无', snap[3].top.s === 'none' && snap[1].left.s === 'none')

  // ══ 9. 无框线 / 10. 所有框线 ══
  await clickPreset('无框线')
  snap = await p.evaluate(dumpBorders)
  ok('无框线：全部清除', snap.every(bd => ['top','right','bottom','left'].every(s => bd[s].s === 'none')))
  await clickPreset('所有框线')
  snap = await p.evaluate(dumpBorders)
  ok('所有框线：全恢复', snap.every(bd => ['top','right','bottom','left'].every(s => bd[s].s === 'solid')))

  // ══ 11. 压塌回归：10 轮 none→all 循环选区稳定（快照恢复生效）══
  let roundsFail = 0
  for (let i = 1; i <= 10; i++) {
    await clickPreset('无框线')
    const cleared = (await p.evaluate(dumpSides)).every(s => s === 'nnnn')
    await clickPreset('所有框线')
    const restored = (await p.evaluate(dumpSides)).every(s => s === 'ssss')
    const selRanges = await p.evaluate(() => (window.__pmView.state.selection.ranges || []).length)
    if (!cleared || !restored || selRanges < 9) roundsFail++
  }
  ok('10 轮循环：选区不塌、边框全对（压塌回归）', roundsFail === 0, `失败轮数=${roundsFail}`)

  // ══ 12. 自绘色板选红色立即生效（用户主诉②）══
  await openBorderMenu()
  // 点线色 swatch 按钮打开色板
  await p.locator('button.w-7.h-6').first().click({ force: true })
  await p.waitForTimeout(300)
  // 第二行第一个色块 = #dc2626（红色）
  const swatches = p.locator('div.grid.grid-cols-6 button')
  await swatches.nth(6).click({ force: true })
  await p.waitForTimeout(600)
  snap = await p.evaluate(dumpBorders)
  ok('色板选红色立即生效（用户主诉②）', snap.every(bd => ['top','right','bottom','left'].every(s => bd[s].c === 'rgb(220, 38, 38)')), JSON.stringify(snap[0].top))

  // ══ 13. 色板 hex 输入自定义色 ══
  await openBorderMenu()
  await p.locator('button.w-7.h-6').first().click({ force: true })
  await p.waitForTimeout(300)
  const hexInput = p.locator('input[placeholder="#000000"]')
  await hexInput.fill('#2563eb')
  await hexInput.press('Enter')
  await p.waitForTimeout(600)
  snap = await p.evaluate(dumpBorders)
  ok('色板 hex 输入 #2563eb 生效', snap.every(bd => ['top','right','bottom','left'].every(s => bd[s].c === 'rgb(37, 99, 235)')), JSON.stringify(snap[0].top))

  // ══ 14. 线宽输入 2.25pt 回车立即生效（用户主诉③）══
  await openBorderMenu()
  const widthInput = p.locator('input[placeholder="pt"]')
  await widthInput.fill('2.25')
  await widthInput.press('Enter')
  await p.waitForTimeout(600)
  snap = await p.evaluate(dumpBorders)
  ok('线宽输入 2.25pt 立即生效（用户主诉③）', snap.every(bd => ['top','right','bottom','left'].every(s => parseFloat(bd[s].w) >= 2)), `w=${snap[0].top.w}`)

  // ══ 15. 快捷档位 3pt 立即生效 ══
  await openBorderMenu()
  await p.locator('div.flex button:has-text("3")').last().click({ force: true })
  await p.waitForTimeout(600)
  snap = await p.evaluate(dumpBorders)
  ok('档位 3pt 立即生效', snap.every(bd => ['top','right','bottom','left'].every(s => parseFloat(bd[s].w) >= 3.5)), `w=${snap[0].top.w}`)

  // ══ 16. 切换预设不丢颜色 ══
  await clickPreset('右框线')
  snap = await p.evaluate(dumpBorders)
  ok('切换不丢颜色：右框线应用后仍蓝色', snap[8].right.s === 'solid' && snap[8].right.c === 'rgb(37, 99, 235)', JSON.stringify(snap[8].right))

  finish(b)
}

function finish(b) {
  const fails = results.filter(r => !r[1])
  console.log(`\n════ 总结: ${results.length - fails.length}/${results.length} PASS ════`)
  if (fails.length) { console.log('FAIL 项：'); fails.forEach(f => console.log('  -', f[0], '|', f[2])) }
  b.close()
}

main().catch(e => { console.error('FATAL', e.message); process.exit(1) })
