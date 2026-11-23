// round55 验证：① Word 脚注样式编辑 ② 四引擎打印预览按钮（横竖/纸张/边距/缩放）
import { chromium } from 'playwright'

const OFFICE = 'http://localhost:18400'
const DOC = '/home/z/my-project/upload/中国区域碳排放影响因素研究20160509.doc'
const PDF = '/tmp/r55-test.pdf'
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
  await p.waitForTimeout(4000)
}

async function firstCardInfo(p) {
  return await p.evaluate(() => {
    const card = document.querySelector('[data-testid="print-preview"] div[style*="box-shadow"]')
    if (!card) return null
    const r = card.getBoundingClientRect()
    return { w: Math.round(r.width), h: Math.round(r.height) }
  })
}

async function previewPaperInfo(p) {
  return await p.evaluate(() => {
    const pv = document.querySelector('[data-testid="print-preview"]')
    const r = pv.getBoundingClientRect()
    return { w: Math.round(r.width), h: Math.round(r.height), transform: pv.style.transform, pad: getComputedStyle(pv).paddingTop, bg: getComputedStyle(pv).backgroundColor }
  })
}

async function main() {
  const b = await chromium.launch({ args: ['--no-sandbox'] })
  const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
  p.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 120)))
  await p.goto(OFFICE, { waitUntil: 'networkidle', timeout: 30000 })
  await p.waitForTimeout(800)
  await p.evaluate(() => { localStorage.setItem('samoffice_lang', 'zh') })
  await p.reload({ waitUntil: 'networkidle' })
  await p.waitForTimeout(1000)

  // ═══ A. Word 脚注样式 ═══
  await openFile(p, DOC)
  await p.evaluate(() => { document.querySelector('div[title*="脚注内容"]').scrollIntoView({ block: 'center' }) })
  await p.waitForTimeout(400)
  const rc = await p.evaluate(() => {
    const row = document.querySelector('div[title*="脚注内容"]')
    const q = row.getBoundingClientRect()
    return { x: q.x + q.width / 2, y: q.y + q.height / 2 }
  })
  await p.mouse.dblclick(rc.x, rc.y)
  await p.waitForTimeout(600)
  const modalOpen = await p.evaluate(() => !!document.querySelector('[data-testid="fn-style-bar"]'))
  ok('A1 脚注弹窗含样式工具栏', modalOpen)
  // 设置样式：加粗 + 字号 14 + 颜色
  await p.locator('[data-testid="fn-style-bar"] button[title="加粗"], [data-testid="fn-style-bar"] button[title*="粗"]').first().click()
  await p.locator('[data-testid="fn-style-bar"] input[type="number"]').fill('14')
  await p.locator('[data-testid="fn-style-bar"] input[type="color"]').fill('#c02121')
  await p.waitForTimeout(200)
  // textarea 样式实时预览
  const taStyle = await p.evaluate(() => {
    const ta = document.querySelector('.modal textarea')
    const s = getComputedStyle(ta)
    return { fw: s.fontWeight, fs: s.fontSize, color: s.color, td: s.textDecorationLine }
  })
  ok('A2 弹窗文本实时预览样式', taStyle.fw === '700' && Math.abs(parseFloat(taStyle.fs) - 14 * 4 / 3) < 0.5 && taStyle.color.includes('192, 33, 33'), JSON.stringify(taStyle))
  await p.locator('[data-testid="fn-save"]').click()
  await p.waitForTimeout(700)
  const rowStyle = await p.evaluate(() => {
    const row = document.querySelector('div[title*="脚注内容"]')
    const span = row.querySelector('span')
    const s = getComputedStyle(span)
    return { fw: s.fontWeight, fs: s.fontSize, color: s.color }
  })
  ok('A3 页底脚注行应用样式', rowStyle.fw === '700' && parseFloat(rowStyle.fs) > 14 && rowStyle.color.includes('192, 33, 33'), JSON.stringify(rowStyle))

  // ═══ B. Word 打印预览 ═══
  await p.locator('button:has-text("视图")').first().click(); await p.waitForTimeout(300)
  await p.locator('[data-testid="word-print-btn"]').click()
  await p.waitForTimeout(700)
  const b1 = await previewPaperInfo(p)
  await p.locator('[data-testid="print-landscape"]').click(); await p.waitForTimeout(300)
  const b2 = await previewPaperInfo(p)
  ok('B1 Word 横竖切换（纸宽>纸高）', b2.w > b2.h && b1.h > b1.w, `${b1.w}x${b1.h} → ${b2.w}x${b2.h}`)
  // 内容宽随横版变宽：克隆内容 transform scale 变大
  const contentScale = async () => await p.evaluate(() => {
    const el = document.querySelector('[data-testid="print-preview"] [style*="scale"]')
    return el ? el.style.transform : ''
  })
  const sPortrait = await (async () => { await p.locator('[data-testid="print-portrait"]').click(); await p.waitForTimeout(300); return contentScale() })()
  const sLandscape = await (async () => { await p.locator('[data-testid="print-landscape"]').click(); await p.waitForTimeout(300); return contentScale() })()
  const num = m => m ? parseFloat(m.match(/scale\(([\d.]+)\)/)?.[1] || '0') : 0
  ok('B2 Word 横版内容变宽（scale 变大）', num(sLandscape) > num(sPortrait), `${sPortrait} → ${sLandscape}`)
  // 纸张大小 A4→A3
  const wA4 = (await previewPaperInfo(p)).w
  await p.locator('[data-testid="print-tab-layout"]').click(); await p.waitForTimeout(300)
  await p.locator('[data-testid="print-paper-size"]').click(); await p.waitForTimeout(400)
  await p.locator('div.ribbon-popup button:has-text("A3")').first().click()
  await p.waitForTimeout(300)
  const wAfter = await previewPaperInfo(p)
  ok('B3 Word 纸张 A4→A3 变宽', wAfter.w > wA4, `${wA4} → ${wAfter.w}`)
  // 边距
  await p.locator('[data-testid="print-margin-top"]').fill('50'); await p.waitForTimeout(300)
  const padAfter = (await previewPaperInfo(p)).pad
  ok('B4 Word 边距生效（padding 变大）', padAfter.includes('75px'), padAfter)
  // 缩放
  await p.locator('[data-testid="print-scale"]').fill('50'); await p.waitForTimeout(300)
  const tr = (await previewPaperInfo(p)).transform
  ok('B5 Word 缩放生效', /scale\(0\.5\)/.test(tr), tr)
  await p.keyboard.press('Escape'); await p.waitForTimeout(300)

  // ═══ C. Excel 打印预览 ═══
  await p.locator('[data-testid="menu-files"]').click({ force: true }); await p.waitForTimeout(400)
  await p.locator('text=📊').first().click({ force: true }); await p.waitForTimeout(1500)
  await p.locator('[data-cell="0-0"]').click(); await p.waitForTimeout(150)
  for (const v of ['标题', 'A', 'B', '行1', '1', '2', '行2', '3', '4']) { await p.keyboard.type(v); await p.keyboard.press('Enter'); await p.waitForTimeout(40) }
  await p.locator('button:has-text("视图")').first().click(); await p.waitForTimeout(300)
  await p.locator('[data-testid="excel-print-btn"]').click(); await p.waitForTimeout(700)
  const c1 = await firstCardInfo(p)
  await p.locator('[data-testid="print-landscape"]').click(); await p.waitForTimeout(300)
  const c2 = await firstCardInfo(p)
  ok('C1 Excel 横竖切换（卡片变横）', !!c2 && c2.w > c2.h, `${JSON.stringify(c1)} → ${JSON.stringify(c2)}`)
  // 打印标题行（round54 功能回归）
  await p.locator('[data-testid="print-tab-advanced"]').click(); await p.waitForTimeout(200)
  await p.locator('[data-testid="print-title-check"]').check(); await p.waitForTimeout(200)
  await p.locator('[data-testid="print-title-rows"]').fill('1'); await p.waitForTimeout(400)
  const c3 = await p.evaluate(() => {
    const pv = document.querySelector('[data-testid="print-preview"]')
    const pages = Array.from(pv.querySelectorAll(':scope > div > div'))
    return { pages: pages.length, p2: (pages[1]?.textContent || '') }
  })
  ok('C2 Excel 打印标题行重复', c3.pages >= 1 && c3.p2.includes('标题'), JSON.stringify({ pages: c3.pages }))
  await p.keyboard.press('Escape'); await p.waitForTimeout(300)

  // ═══ D. PPT 打印预览 ═══
  await p.locator('[data-testid="menu-files"]').click({ force: true }); await p.waitForTimeout(400)
  await p.locator('text=📽').first().click({ force: true })
  await p.waitForTimeout(2000)
  // 空白版式幻灯片 —— 填内容 textarea（SlideThumb 无形状时渲染 title/content）
  const contentBox = p.locator('.slide-canvas textarea').first()
  if (await contentBox.count()) { await contentBox.fill('PPT标题测试'); await p.waitForTimeout(500) }
  // PPT 打印按钮可能在 视图 tab —— 先点视图
  await p.locator('button:has-text("视图")').first().click().catch(() => {}); await p.waitForTimeout(300)
  const hasPpt = await p.locator('[data-testid="ppt-print-btn"]').count()
  if (hasPpt) {
    await p.locator('[data-testid="ppt-print-btn"]').click(); await p.waitForTimeout(700)
    const d1 = await previewPaperInfo(p)
    await p.locator('[data-testid="print-landscape"]').click(); await p.waitForTimeout(300)
    const d2 = await previewPaperInfo(p)
    ok('D1 PPT 横竖切换（卡片变横）', d2.w > d2.h, `${d1.w}x${d1.h} → ${d2.w}x${d2.h}`)
    // 幻灯片缩略图（SlideThumb 是 div 渲染）—— 预览应包含所输入标题文本
    const d3 = await p.evaluate(() => {
      const pv = document.querySelector('[data-testid="print-preview"]')
      return { hasTitle: (pv?.textContent || '').includes('PPT标题测试'), cards: pv ? pv.querySelectorAll('div[style*="box-shadow"]').length : 0 }
    })
    ok('D2 PPT 幻灯片缩略图渲染（含标题）', d3.hasTitle && d3.cards > 0, JSON.stringify(d3))
    await p.keyboard.press('Escape')
  } else {
    ok('D1 PPT 打印按钮存在', false, '未找到 ppt-print-btn（菜单入口定位失败）')
  }

  // ═══ E. PDF 打印预览 ═══
  await openFile(p, PDF)
  await p.waitForTimeout(2500)
  const pdfBtnCount = await p.locator('[data-testid="pdf-print-btn"]').count().catch(() => 0)
  if (pdfBtnCount) {
    await p.locator('[data-testid="pdf-print-btn"]').click()
    await p.waitForTimeout(3000)
    const e1 = await p.evaluate(() => {
      const imgs = document.querySelectorAll('[data-testid="print-preview"] img')
      return { n: imgs.length }
    })
    ok('E1 PDF 真实页面渲染（≥2 页图）', e1.n >= 2, JSON.stringify(e1))
    const f1 = await firstCardInfo(p)
    await p.locator('[data-testid="print-landscape"]').click(); await p.waitForTimeout(300)
    const f2 = await firstCardInfo(p)
    ok('E2 PDF 横竖切换（卡片变横）', !!f2 && f2.w > f2.h, `${JSON.stringify(f1)} → ${JSON.stringify(f2)}`)
    // 页范围 current → 单页
    await p.locator('label:has(input[type="radio"])').filter({ hasText: /当前页|Current/ }).locator('input[type="radio"]').check(); await p.waitForTimeout(300)
    const e3 = await p.evaluate(() => document.querySelectorAll('[data-testid="print-preview"] img').length)
    ok('E3 PDF 页范围=当前页 → 1 页', e3 === 1, String(e3))
    await p.keyboard.press('Escape')
  } else {
    ok('E1 PDF 打印按钮存在', false, '未找到 PDF 打印按钮')
  }

  console.log('---')
  const pass = results.filter(r => r[1]).length
  console.log(`TOTAL: ${pass}/${results.length} PASS`)
  await p.screenshot({ path: '/tmp/r55-final.png' })
  await b.close()
}
main().catch(e => { console.error(e); process.exit(1) })
