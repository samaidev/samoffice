// round57 验证：① 打印预览多页可见（word 卡片流）② 每版打印页数拼版（word/excel）+ 实际拼版打印
// ③ PPT 每页张数 + 全套幻灯片打印 ④ 三编辑器多页预览视图（word 多页/excel 分页/ppt 浏览）
import { chromium } from 'playwright'

const OFFICE = 'http://localhost:18400'
const DOC = '/home/z/my-project/upload/中国区域碳排放影响因素研究20160509.doc'
const results = []
const ok = (name, pass, info = '') => { results.push([name, !!pass, info]); console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${info}`) }

async function openFile(p, path, icon) {
  const [chooser] = await Promise.all([
    p.waitForEvent('filechooser', { timeout: 8000 }),
    (async () => {
      await p.locator('[data-testid="menu-files"]').click({ force: true }); await p.waitForTimeout(400)
      await p.locator(`text=${icon}`).first().click({ force: true })
    })(),
  ])
  await chooser.setFiles(path)
  await p.waitForTimeout(4500)
}

async function main() {
  const b = await chromium.launch({ args: ['--no-sandbox'] })
  const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
  p.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 150)))
  await p.addInitScript(() => {
    window.__printCalls = 0
    window.__printCapture = null
    window.print = () => {
      window.__printCalls++
      const tiled = document.getElementById('print-dialog-tiled-holder')
      const sel = document.getElementById('print-dialog-selection-holder')
      const style = document.getElementById('print-dialog-style')
      window.__printCapture = {
        tiledHTML: tiled ? tiled.innerHTML.slice(0, 3000) : null,
        tiledPapers: tiled ? tiled.querySelectorAll('.print-paper').length : 0,
        tiledCells: tiled ? tiled.querySelectorAll('[data-page]').length : -1,
        selHTML: sel ? sel.innerHTML.slice(0, 200) : null,
        styleCSS: style ? style.textContent : '',
      }
    }
  })
  await p.goto(OFFICE, { waitUntil: 'networkidle', timeout: 30000 })
  await p.waitForTimeout(800)
  await p.evaluate(() => { localStorage.setItem('samoffice_lang', 'zh') })
  await p.reload({ waitUntil: 'networkidle' })
  await p.waitForTimeout(1000)

  // ═══ A. Word 打印预览：多页同时可见 ═══
  await openFile(p, DOC, '📂')
  await p.locator('button:has-text("视图")').first().click(); await p.waitForTimeout(300)
  await p.locator('[data-testid="word-print-btn"]').click(); await p.waitForTimeout(1200)
  const flowInfo = await p.evaluate(() => {
    const cards = document.querySelectorAll('[data-testid="print-flow-card"]')
    const indicator = document.querySelector('[data-testid="print-page-indicator"]')
    return { cards: cards.length, indicator: indicator?.textContent || '', hasContent: !!document.querySelector('[data-testid="print-flow"] .ProseMirror') }
  })
  ok('A1 Word 打印预览多页卡片流（≥3 张纸卡同屏可见）', flowInfo.cards >= 3, JSON.stringify(flowInfo))
  ok('A2 页码指示完整（N/M 格式，N>1）', /^\s*[2-9]\s*\/\s*[2-9]/.test(flowInfo.indicator) || /\d+\s*\/\s*\d+/.test(flowInfo.indicator) && parseInt(flowInfo.indicator.split('/')[1]) > 1, flowInfo.indicator)

  // A3: 翻页仍可用（▶ → 第 2 页卡片滚动可见）
  await p.locator('[data-testid="print-page-next"]').click(); await p.waitForTimeout(500)
  const navOk = await p.evaluate(() => {
    const ind = document.querySelector('[data-testid="print-page-indicator"]')?.textContent || ''
    return ind.startsWith('2')
  })
  ok('A3 翻页导航可用（当前页 2）', navOk, '')

  // A4: 每版 4 页拼版
  await p.locator('[data-testid="print-tab-layout"]').click(); await p.waitForTimeout(300)
  await p.locator('[data-testid="print-perpage-4"]').click(); await p.waitForTimeout(900)
  const tileInfo = await p.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('[data-testid="print-flow-card"]'))
    // 懒挂载：找第一张已挂载的卡（含 [data-page] 切片格）
    const mounted = cards.find(c => c.querySelectorAll('[data-page]').length > 0) || cards[0]
    const cells = mounted ? mounted.querySelectorAll('[data-page]').length : 0
    return { cards: cards.length, cells, grid: mounted ? (mounted.querySelector('[style*="grid"]') ? 'grid' : 'no') : '' }
  })
  ok('A4 每版4页拼版（28页→7卡、每卡4格）', tileInfo.cards >= 5 && tileInfo.cards <= 9 && tileInfo.cells === 4, JSON.stringify(tileInfo))

  // A5: 拼版打印（renderPrint → 拼版容器 + break-after + zoom 校准）
  await p.evaluate(() => { window.__printCalls = 0; window.__printCapture = null })
  await p.locator('[data-testid="print-confirm"]').click(); await p.waitForTimeout(900)
  const capA = await p.evaluate(() => window.__printCapture)
  // zoom 校准值 ≈ 251.969%（预览 px×2.5197 → 物理 mm；100% 缩放时）
  ok('A5 拼版打印容器（.print-paper×N + 分页 CSS + zoom 校准）',
    capA && capA.tiledPapers >= 1 && /break-after:\s*page/.test(capA.styleCSS || '') && /zoom:\s*2\d\d\./.test(capA.styleCSS || ''),
    `papers=${capA?.tiledPapers} cells=${capA?.tiledCells}`)
  await p.waitForTimeout(1200)

  // A6: 自定义页码范围 1-2
  await p.locator('.ProseMirror p').first().click(); await p.waitForTimeout(200)
  await p.locator('[data-testid="word-print-btn"]').click(); await p.waitForTimeout(1100)
  await p.locator('[data-testid="print-tab-general"]').click(); await p.waitForTimeout(300)
  await p.locator('[data-testid="print-range-custom"]').check(); await p.waitForTimeout(300)
  await p.locator('[data-testid="print-custom-pages"]').fill('1-2'); await p.waitForTimeout(600)
  const customInfo = await p.evaluate(() => {
    const cards = document.querySelectorAll('[data-testid="print-flow-card"]')
    const cells = cards[0] ? cards[0].querySelectorAll('[data-page]').length : 0
    return { cards: cards.length, cells }
  })
  ok('A6 自定义页码范围 1-2（perPage=4 下 1 卡含页1/2 两格）', customInfo.cards === 1 && customInfo.cells === 2, JSON.stringify(customInfo))
  await p.keyboard.press('Escape'); await p.waitForTimeout(400)

  // ═══ B. Word 编辑器多页预览视图 ═══
  await p.locator('button:has-text("视图")').first().click(); await p.waitForTimeout(200)
  await p.locator('[data-testid="word-pages-btn"]').click(); await p.waitForTimeout(1000)
  const pagesView = await p.evaluate(() => {
    const v = document.querySelector('[data-testid="word-pages-view"]')
    const cards = document.querySelectorAll('[data-testid="word-pages-flow-card"]')
    return { visible: v ? getComputedStyle(v).display !== 'none' : false, cards: cards.length, text: v?.textContent?.includes('多页预览') || false }
  })
  ok('B1 Word 多页预览视图（覆盖层 + A4 页卡流）', pagesView.visible && pagesView.cards >= 3, JSON.stringify(pagesView))
  await p.locator('[data-testid="word-pages-back"]').click(); await p.waitForTimeout(400)
  const backOk = await p.evaluate(() => {
    const v = document.querySelector('[data-testid="word-pages-view"]')
    return v ? getComputedStyle(v).display === 'none' : false
  })
  ok('B2 返回编辑（覆盖层关闭，编辑器可用）', backOk, '')

  // ═══ C. Excel：每版拼版 + 分页预览视图 ═══
  await p.locator('[data-testid="menu-files"]').click({ force: true }); await p.waitForTimeout(400)
  await p.locator('text=📊').first().click({ force: true }); await p.waitForTimeout(1500)
  await p.locator('[data-cell="0-0"]').click(); await p.waitForTimeout(150)
  for (const v of ['区域', '省份', '排放', '东部', '西部', '北部', '南部', '中部']) { await p.keyboard.type(v); await p.waitForTimeout(40); await p.keyboard.press('Enter'); await p.waitForTimeout(40) }
  // C1: 每版 2 页拼版
  await p.locator('button:has-text("视图")').first().click(); await p.waitForTimeout(300)
  await p.locator('[data-testid="excel-print-btn"]').click(); await p.waitForTimeout(900)
  await p.locator('[data-testid="print-tab-layout"]').click(); await p.waitForTimeout(300)
  await p.locator('[data-testid="print-perpage-2"]').click(); await p.waitForTimeout(700)
  const excelTile = await p.evaluate(() => {
    const cards = document.querySelectorAll('[data-testid="print-preview"] .print-paper')
    const first = cards[0]
    return { cards: cards.length, gridCells: first ? first.querySelectorAll('[style*="grid"] > div').length : 0 }
  })
  ok('C1 Excel 每版2页（网格拼版）', excelTile.cards >= 1 && excelTile.gridCells >= 2, JSON.stringify(excelTile))
  // C2: 拼版打印
  await p.evaluate(() => { window.__printCalls = 0; window.__printCapture = null })
  await p.locator('[data-testid="print-confirm"]').click(); await p.waitForTimeout(900)
  const capC = await p.evaluate(() => window.__printCapture)
  ok('C2 Excel 拼版打印容器', capC && capC.tiledPapers >= 1 && capC.tiledHTML && capC.tiledHTML.includes('<table'), `papers=${capC?.tiledPapers}`)
  await p.waitForTimeout(1200)
  // C3: 分页预览视图
  await p.locator('button:has-text("视图")').first().click(); await p.waitForTimeout(200)
  await p.locator('[data-testid="excel-pages-btn"]').click(); await p.waitForTimeout(800)
  const excelView = await p.evaluate(() => {
    const v = document.querySelector('[data-testid="excel-pages-view"]')
    return { visible: v ? getComputedStyle(v).display !== 'none' : false, papers: v ? v.querySelectorAll('.print-paper').length : 0, hasData: v ? (v.textContent || '').includes('区域') : false }
  })
  ok('C3 Excel 分页预览视图（纸张卡 + 数据可见）', excelView.visible && excelView.papers >= 1 && excelView.hasData, JSON.stringify(excelView))
  await p.locator('[data-testid="excel-pages-back"]').click(); await p.waitForTimeout(300)
  const excelBack = await p.evaluate(() => getComputedStyle(document.querySelector('[data-testid="excel-pages-view"]')).display === 'none')
  ok('C4 Excel 返回编辑', excelBack, '')

  // ═══ D. PPT：每页张数 + 全套打印 + 幻灯片浏览 ═══
  await p.locator('[data-testid="menu-files"]').click({ force: true }); await p.waitForTimeout(400)
  await p.locator('text=📽').first().click({ force: true }); await p.waitForTimeout(2000)
  await p.locator('.slide-canvas textarea').first().fill('第一页内容'); await p.waitForTimeout(400)
  await p.locator('button').filter({ hasText: /^\+$/ }).first().click(); await p.waitForTimeout(800)
  await p.locator('.slide-canvas textarea').first().fill('第二页内容'); await p.waitForTimeout(400)
  // D1: 每页 2 张讲义
  await p.locator('button:has-text("视图")').first().click(); await p.waitForTimeout(300)
  await p.locator('[data-testid="ppt-print-btn"]').click(); await p.waitForTimeout(900)
  await p.locator('[data-testid="print-slides-2"]').click(); await p.waitForTimeout(700)
  const pptTile = await p.evaluate(() => {
    const pv = document.querySelector('[data-testid="print-preview"]')
    const cards = pv ? pv.querySelectorAll('.print-paper').length : 0
    return { cards, text: pv?.textContent || '' }
  })
  ok('D1 PPT 每页2张讲义（2 页 → 1 张纸）', pptTile.cards === 1 && pptTile.text.includes('第一页内容') && pptTile.text.includes('第二页内容'), JSON.stringify({ cards: pptTile.cards }))
  // D2: 全套幻灯片打印（renderPrint 常供 → 拼版容器）
  await p.evaluate(() => { window.__printCalls = 0; window.__printCapture = null })
  await p.locator('[data-testid="print-confirm"]').click(); await p.waitForTimeout(900)
  const capD = await p.evaluate(() => window.__printCapture)
  ok('D2 PPT 全套幻灯片实际打印（拼版容器含两页内容）', capD && capD.tiledPapers >= 1 && (capD.tiledHTML || '').includes('第一页') && (capD.tiledHTML || '').includes('第二页'), `papers=${capD?.tiledPapers}`)
  await p.waitForTimeout(1200)
  // D3: 幻灯片浏览视图
  await p.locator('button:has-text("视图")').first().click(); await p.waitForTimeout(200)
  await p.locator('[data-testid="ppt-browse-btn"]').click(); await p.waitForTimeout(700)
  const browseView = await p.evaluate(() => {
    const v = document.querySelector('[data-testid="ppt-browse-view"]')
    return { visible: v ? getComputedStyle(v).display !== 'none' : false, cards: document.querySelectorAll('[data-testid^="ppt-browse-card-"]').length }
  })
  ok('D3 PPT 幻灯片浏览（概览网格 2 张卡）', browseView.visible && browseView.cards === 2, JSON.stringify(browseView))
  await p.locator('[data-testid="ppt-browse-card-1"]').click(); await p.waitForTimeout(600)
  const browseBack = await p.evaluate(() => {
    const v = document.querySelector('[data-testid="ppt-browse-view"]')
    return { hidden: v ? getComputedStyle(v).display === 'none' : true, canvasText: (document.querySelector('.slide-canvas')?.textContent || '') }
  })
  ok('D4 点击卡片跳转该页并返回编辑', browseBack.hidden && browseBack.canvasText.includes('第二页内容'), browseBack.canvasText.slice(0, 30))

  console.log('---')
  const pass = results.filter(r => r[1]).length
  console.log(`TOTAL: ${pass}/${results.length} PASS`)
  await b.close()
}
main().catch(e => { console.error(e); process.exit(1) })
