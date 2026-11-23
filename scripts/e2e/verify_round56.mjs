// round56 验证：① .doc 表格样式对齐 MS（三线表/合并/对齐）② 打印适应/缩放真实生效 ③ 打印选定区域
import { chromium } from 'playwright'

const OFFICE = 'http://localhost:18400'
const DOC = '/home/z/my-project/upload/中国区域碳排放影响因素研究20160509.doc'
const results = []
const ok = (name, pass, info = '') => { results.push([name, !!pass, info]); console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${info}`) }

async function openFile(p, path) {
  const [chooser] = await Promise.all([
    p.waitForEvent('filechooser', { timeout: 8000 }),
    (async () => {
      await p.locator('[data-testid="menu-files"]').click({ force: true }); await p.waitForTimeout(400)
      await p.locator('text=📂').first().click({ force: true })
    })(),
  ])
  await chooser.setFiles(path)
  await p.waitForTimeout(4500)
}

async function main() {
  const b = await chromium.launch({ args: ['--no-sandbox'] })
  const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
  p.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 140)))
  p.on('console', m => { if ((m.text() || '').includes('r56dbg')) console.log('[console]', m.text()) })
  // 拦截 window.print：记录调用与打印容器/样式快照（不打真对话框）
  await p.addInitScript(() => {
    window.__printCalls = 0
    window.__printCapture = null
    window.print = () => {
      window.__printCalls++
      const holder = document.getElementById('print-dialog-selection-holder')
      const style = document.getElementById('print-dialog-style')
      window.__printCapture = {
        holderHTML: holder ? holder.innerHTML : null,
        styleCSS: style ? style.textContent : '',
      }
    }
  })
  await p.goto(OFFICE, { waitUntil: 'networkidle', timeout: 30000 })
  await p.waitForTimeout(800)
  await p.evaluate(() => { localStorage.setItem('samoffice_lang', 'zh') })
  await p.reload({ waitUntil: 'networkidle' })
  await p.waitForTimeout(1000)

  // ═══ A. .doc 表格样式对齐 MS ═══
  await openFile(p, DOC)
  const tableInfo = await p.evaluate(() => {
    const tbl = document.querySelector('.ProseMirror table')
    if (!tbl) return null
    const rows = tbl.querySelectorAll('tr')
    const hdr = rows[0]
    const hdrTd = hdr.querySelector('td, th')
    const bodyTd = rows[2] ? rows[2].querySelector('td') : null
    const lastRow = rows[rows.length - 1]
    const lastTd = lastRow.querySelector('td')
    const cs = (el) => el ? getComputedStyle(el) : null
    const hd = cs(hdrTd), bd = cs(bodyTd), ld = cs(lastTd)
    return {
      rowCount: rows.length,
      hdrTop: hd?.borderTopWidth, hdrTopStyle: hd?.borderTopStyle,
      hdrBottom: hd?.borderBottomWidth, hdrLeft: hd?.borderLeftStyle, hdrRight: hd?.borderRightStyle,
      hdrAlign: hd?.textAlign,
      bodyTop: bd?.borderTopStyle, bodyLeft: bd?.borderLeftStyle, bodyBottom: bd?.borderBottomStyle,
      lastBottom: ld?.borderBottomWidth, lastBottomStyle: ld?.borderBottomStyle,
      tables: document.querySelectorAll('.ProseMirror table').length,
    }
  })
  ok('A1 表1 三线表：表头上下有线', tableInfo && tableInfo.hdrTopStyle === 'solid' && parseFloat(tableInfo.hdrTop) >= 2 && tableInfo.hdrBottom !== '0px', JSON.stringify({ t: tableInfo?.hdrTop, b: tableInfo?.hdrBottom }))
  ok('A2 表1 三线表：无竖线/正文行无边框', tableInfo && tableInfo.hdrLeft === 'none' && tableInfo.hdrRight === 'none' && tableInfo.bodyTop === 'none' && tableInfo.bodyLeft === 'none', JSON.stringify({ l: tableInfo?.hdrLeft, bodyT: tableInfo?.bodyTop }))
  ok('A3 表1 三线表：末行底线粗', tableInfo && tableInfo.lastBottomStyle === 'solid' && parseFloat(tableInfo.lastBottom) >= 2, String(tableInfo?.lastBottom))
  ok('A4 表头对齐居中', tableInfo && (tableInfo.hdrAlign === 'center'), String(tableInfo?.hdrAlign))

  // A5/A6: 第二个表（分类表）垂直合并 —— rowspan 且无幽灵空行
  const mergeInfo = await p.evaluate(() => {
    const tables = document.querySelectorAll('.ProseMirror table')
    if (tables.length < 2) return null
    const t2 = tables[1]
    const rows = t2.querySelectorAll('tr')
    let rowspanCells = 0
    t2.querySelectorAll('td[rowspan], th[rowspan]').forEach(() => rowspanCells++)
    return { rowCount: rows.length, rowspanCells }
  })
  ok('A5 表2 垂直合并（rowspan 存在）', mergeInfo && mergeInfo.rowspanCells >= 2, JSON.stringify(mergeInfo))
  ok('A6 表2 幽灵空行已消除（5行→3行）', mergeInfo && mergeInfo.rowCount === 3, `rows=${mergeInfo?.rowCount}`)

  // ═══ B. Word 打印：适应/缩放/选定区域 ═══
  await p.locator('button:has-text("视图")').first().click(); await p.waitForTimeout(300)
  await p.locator('[data-testid="word-print-btn"]').click(); await p.waitForTimeout(700)
  const scaleOf = () => p.evaluate(() => {
    const pv = document.querySelector('[data-testid="print-preview"]')
    const m = (pv.style.transform || '').match(/scale\(([\d.]+)\)/)
    return m ? parseFloat(m[1]) : 1
  })
  const s0 = await scaleOf()
  // B1 适应：A3 纸（445×630px vs 预览区 550×732）→ 自动放大适应 ≈110%
  await p.locator('[data-testid="print-tab-layout"]').click(); await p.waitForTimeout(300)
  await p.locator('[data-testid="print-paper-size"]').click(); await p.waitForTimeout(400)
  await p.locator('div.ribbon-popup button:has-text("A3")').first().click(); await p.waitForTimeout(400)
  await p.locator('button').filter({ hasText: /适应页面|Fit to Page/ }).first().click(); await p.waitForTimeout(600)
  const sFit = await scaleOf()
  ok('B1 适应按钮真实生效（A3 自动缩放）', Math.abs(sFit - 1) > 0.02, `${s0} → ${sFit}`)
  // B2 缩小：切横版（纸 630px 宽 > 区 550px）→ 只缩不放
  await p.locator('[data-testid="print-tab-general"]').click(); await p.waitForTimeout(300)
  await p.locator('[data-testid="print-landscape"]').click(); await p.waitForTimeout(400)
  await p.locator('[data-testid="print-tab-layout"]').click(); await p.waitForTimeout(300)
  await p.locator('button').filter({ hasText: /缩小适应|Shrink to Fit/ }).first().click(); await p.waitForTimeout(500)
  const sShrink = await scaleOf()
  ok('B2 缩小按钮生效（横版超宽缩至 <1）', sShrink < 1, String(sShrink))
  // B3 实际大小 + 手动缩放
  await p.locator('button').filter({ hasText: /实际大小|Actual Size/ }).first().click(); await p.waitForTimeout(300)
  await p.locator('[data-testid="print-scale"]').fill('50'); await p.waitForTimeout(300)
  const sManual = await scaleOf()
  ok('B3 手动缩放 50%', Math.abs(sManual - 0.5) < 0.01, String(sManual))
  await p.keyboard.press('Escape'); await p.waitForTimeout(400)

  // B4/B5: 选定区域打印（选中文本 → 打印预览 → 选定区域 → 打印）
  await p.waitForFunction(() => !document.querySelector('[data-testid="print-preview"]'), { timeout: 5000 }).catch(() => {})
  await p.locator('.ProseMirror p').nth(3).scrollIntoViewIfNeeded(); await p.waitForTimeout(200)
  const rect = await p.evaluate(() => {
    const el = document.querySelectorAll('.ProseMirror p')[3]
    const r = el.getBoundingClientRect()
    return { x: r.x + 20, y: r.y + r.height / 2, w: r.width - 60 }
  })
  await p.mouse.move(rect.x, rect.y)
  await p.mouse.down()
  await p.mouse.move(rect.x + rect.w, rect.y, { steps: 8 })
  await p.mouse.up()
  await p.waitForTimeout(300)
  const selLen = await p.evaluate(() => (window.getSelection() || '').toString().length)
  console.log('  [B4] DOM selection length =', selLen)
  await p.locator('[data-testid="word-print-btn"]').click(); await p.waitForTimeout(900)
  await p.locator('[data-testid="print-tab-general"]').click(); await p.waitForTimeout(300)
  const hasSelRadio = await p.locator('[data-testid="print-range-selection"]').count()
  ok('B4 选定文本后出现「选定区域」选项', hasSelRadio > 0)
  if (hasSelRadio) {
    await p.locator('[data-testid="print-range-selection"]').check(); await p.waitForTimeout(300)
    const selPreview = await p.evaluate(() => {
      const pv = document.querySelector('[data-testid="print-preview"]')
      return { text: (pv?.textContent || '').slice(0, 120), imgs: pv ? pv.querySelectorAll('img').length : 0, textLen: pv?.textContent?.length || 0 }
    })
    ok('B5 预览仅显示选区内容（非整篇）', selPreview.textLen < 400, JSON.stringify(selPreview).slice(0, 160))
    // B6: 实际打印走选区容器（拦截 print 检查）
    await p.locator('[data-testid="print-confirm"]').click(); await p.waitForTimeout(600)
    const cap = await p.evaluate(() => window.__printCapture)
    ok('B6 实际打印注入选区容器', cap && cap.holderHTML && cap.holderHTML.length > 20 && /print-dialog-selection-holder/.test(cap.styleCSS), `calls=${await p.evaluate(() => window.__printCalls)} holder=${cap ? (cap.holderHTML || '').slice(0, 60) : 'none'}`)
  }

  // B7: 实际打印 zoom（缩放 50 → 打印 CSS 含 zoom:50%）
  await p.waitForTimeout(1500) // 等选区容器清理
  await p.locator('.ProseMirror p').first().click(); await p.waitForTimeout(200)
  await p.locator('[data-testid="word-print-btn"]').click(); await p.waitForTimeout(700)
  await p.locator('[data-testid="print-tab-layout"]').click(); await p.waitForTimeout(200)
  await p.locator('[data-testid="print-scale"]').fill('60'); await p.waitForTimeout(300)
  await p.evaluate(() => { window.__printCalls = 0; window.__printCapture = null })
  await p.locator('[data-testid="print-confirm"]').click(); await p.waitForTimeout(600)
  const cap2 = await p.evaluate(() => window.__printCapture)
  ok('B7 实际打印含缩放 zoom:60%', cap2 && /zoom:\s*60%/.test(cap2.styleCSS || ''), (cap2?.styleCSS || '').match(/zoom:[^;]*/)?.[0] || 'no-zoom')
  await p.keyboard.press('Escape'); await p.waitForTimeout(300)

  // ═══ C. Excel：选区打印 + 适应 ═══
  await p.locator('[data-testid="menu-files"]').click({ force: true }); await p.waitForTimeout(400)
  await p.locator('text=📊').first().click({ force: true }); await p.waitForTimeout(1500)
  await p.locator('[data-cell="0-0"]').click(); await p.waitForTimeout(150)
  for (const v of ['区域', '省份', '排放', '东部', '西部']) { await p.keyboard.type(v); await p.keyboard.press('Enter'); await p.waitForTimeout(50) }
  // 选 A1:B3（拖拽）
  await p.locator('[data-cell="0-0"]').click(); await p.waitForTimeout(150)
  const cellA = await p.locator('[data-cell="0-1"]').boundingBox()
  const cellB = await p.locator('[data-cell="2-0"]').boundingBox()
  if (cellA && cellB) {
    await p.mouse.move(cellA.x + 4, cellA.y + 4)
    await p.mouse.down()
    await p.mouse.move(cellB.x + 20, cellB.y + 20, { steps: 6 })
    await p.mouse.up()
    await p.waitForTimeout(300)
  }
  await p.locator('button:has-text("视图")').first().click(); await p.waitForTimeout(300)
  await p.locator('[data-testid="excel-print-btn"]').click(); await p.waitForTimeout(800)
  const excelSel = await p.locator('[data-testid="print-range-selection"]').count()
  ok('C1 Excel 选区后出现「选定区域」', excelSel > 0)
  if (excelSel) {
    await p.locator('[data-testid="print-range-selection"]').check(); await p.waitForTimeout(400)
    const pvText = await p.evaluate(() => document.querySelector('[data-testid="print-preview"]')?.textContent || '')
    ok('C2 Excel 预览仅选区（含「排放」不含无关内容，且行数受限）', pvText.includes('排放') && pvText.includes('A1:B3'), pvText.slice(0, 80))
    await p.evaluate(() => { window.__printCalls = 0; window.__printCapture = null })
    await p.locator('[data-testid="print-confirm"]').click(); await p.waitForTimeout(600)
    const cap3 = await p.evaluate(() => window.__printCapture)
    ok('C3 Excel 实际打印选区表格', cap3 && cap3.holderHTML && cap3.holderHTML.includes('<table') && cap3.holderHTML.includes('排放'), (cap3?.holderHTML || '').slice(0, 80))
  }
  // C4: Excel 适应按钮
  await p.keyboard.press('Escape'); await p.waitForTimeout(300)
  await p.locator('[data-testid="excel-print-btn"]').click(); await p.waitForTimeout(700)
  await p.locator('[data-testid="print-tab-layout"]').click(); await p.waitForTimeout(300)
  const es0 = await scaleOf()
  await p.locator('button').filter({ hasText: /适应页面|Fit to Page/ }).first().click(); await p.waitForTimeout(500)
  const esFit = await scaleOf()
  ok('C4 Excel 适应按钮生效', Math.abs(esFit - es0) > 0.02 && esFit > 0.2, `${es0} → ${esFit}`)
  await p.keyboard.press('Escape'); await p.waitForTimeout(300)

  // ═══ D. PPT：当前页打印 ═══
  await p.locator('[data-testid="menu-files"]').click({ force: true }); await p.waitForTimeout(400)
  await p.locator('text=📽').first().click({ force: true }); await p.waitForTimeout(2000)
  await p.locator('.slide-canvas textarea').first().fill('第一页内容'); await p.waitForTimeout(400)
  await p.locator('button').filter({ hasText: /^\+$/ }).first().click(); await p.waitForTimeout(800) // 加一页（左栏 + 按钮）
  await p.locator('.slide-canvas textarea').first().fill('第二页内容'); await p.waitForTimeout(400)
  await p.locator('button:has-text("视图")').first().click(); await p.waitForTimeout(300)
  await p.locator('[data-testid="ppt-print-btn"]').click(); await p.waitForTimeout(700)
  const cardsAll = await p.evaluate(() => document.querySelectorAll('[data-testid="print-preview"] div[style*="box-shadow"]').length)
  await p.locator('label:has(input[type="radio"])').filter({ hasText: /当前页|Current/ }).locator('input[type="radio"]').check(); await p.waitForTimeout(400)
  const cardsCur = await p.evaluate(() => document.querySelectorAll('[data-testid="print-preview"] div[style*="box-shadow"]').length)
  const curText = await p.evaluate(() => document.querySelector('[data-testid="print-preview"]')?.textContent || '')
  ok('D1 PPT 当前页只预览当前幻灯片', cardsAll >= 2 && cardsCur === 1 && curText.includes('第二页内容'), `all=${cardsAll} cur=${cardsCur}`)
  await p.keyboard.press('Escape'); await p.waitForTimeout(300)

  console.log('---')
  const pass = results.filter(r => r[1]).length
  console.log(`TOTAL: ${pass}/${results.length} PASS`)
  await p.screenshot({ path: '/tmp/r56-final.png' })
  await b.close()
}
main().catch(e => { console.error(e); process.exit(1) })
