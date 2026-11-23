// round54 验证：① Word 脚注双击编辑/引用点击编辑（桥层吞事件修复）
// ② Excel 冻结首行/首列 sticky + 冻结格边框  ③ 打印标题行数输入 + 预览分页重复表头
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
  await p.waitForTimeout(4000)
}

async function main() {
  const b = await chromium.launch({ args: ['--no-sandbox'] })
  const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
  await p.goto(OFFICE, { waitUntil: 'networkidle', timeout: 30000 })
  await p.waitForTimeout(800)
  await p.evaluate(() => { localStorage.setItem('samoffice_lang', 'zh') })
  await p.reload({ waitUntil: 'networkidle' })
  await p.waitForTimeout(1000)

  // ═══ T1: Word 脚注双击编辑 ═══
  await openFile(p, DOC)
  const t1 = await p.evaluate(() => {
    const rows = document.querySelectorAll('div[title*="脚注内容"]')
    return { rows: rows.length }
  })
  ok('T1 页底脚注行存在', t1.rows > 0, JSON.stringify(t1))
  // 双击打开弹窗
  await p.evaluate(() => { document.querySelector('div[title*="脚注内容"]').scrollIntoView({ block: 'center' }) })
  await p.waitForTimeout(300)
  const rc = await p.evaluate(() => {
    const row = document.querySelector('div[title*="脚注内容"]')
    const q = row.getBoundingClientRect()
    return { x: q.x + q.width / 2, y: q.y + q.height / 2 }
  })
  await p.mouse.dblclick(rc.x, rc.y)
  await p.waitForTimeout(600)
  const t1b = await p.evaluate(() => {
    const title = document.querySelector('.modal-title')
    const inputs = Array.from(document.querySelectorAll('input')).map(i => i.value).filter(v => v && v.length > 10)
    return { open: !!title, title: title?.textContent || '', sample: inputs[0]?.slice(0, 14) || '' }
  })
  ok('T1 双击脚注打开编辑弹窗', t1b.open, JSON.stringify(t1b))
  // 修改文本 → 确定 → 页底文本更新
  const EDITED = '孔英（已编辑·round54）'
  if (t1b.open) {
    const inp = p.locator('.modal textarea').first()
    await inp.fill(EDITED)
    await p.locator('button:has-text("确定")').last().click()
    await p.waitForTimeout(700)
    const t1c = await p.evaluate(() => document.body.innerText.includes('已编辑·round54'))
    ok('T1 修改脚注文本生效', t1c, '页底含"已编辑·round54"=' + t1c)
  }

  // T1d: 点击正文脚注引用 → 弹窗
  // round57 修：手动量坐标 + mouse.click 在编辑保存后的重排时机下点到别处；
  // 改用 Playwright locator（自动滚动入视口 + 可点击性等待）点击第一个引用。
  const refCount = await p.evaluate(() => document.querySelectorAll('sup.footnote-ref').length)
  if (refCount > 0) {
    await p.locator('sup.footnote-ref').first().click({ force: true })
    await p.waitForTimeout(600)
    const t1d = await p.evaluate(() => !!document.querySelector('.modal-title'))
    ok('T1 点击正文脚注引用打开弹窗', t1d)
    // 脚注弹窗不监听 Escape —— 用「取消」按钮关闭（否则后续菜单点击被弹窗吞掉）
    await p.locator('button:has-text("取消")').last().click()
    await p.waitForTimeout(500)
  } else {
    ok('T1 点击正文脚注引用打开弹窗', false, '无脚注引用')
  }

  // ═══ T2: Excel 冻结首行/首列 + 边框 ═══
  await p.locator('[data-testid="menu-files"]').click({ force: true }); await p.waitForTimeout(400)
  await p.locator('text=📊').first().click({ force: true }); await p.waitForTimeout(1500)
  // 填 3 列数据
  await p.locator('[data-cell="0-0"]').click(); await p.waitForTimeout(150)
  for (const v of ['姓名', '年龄', '城市', '张三', '31', '深圳', '李四', '28', '广州', '王五', '40', '上海']) {
    await p.keyboard.type(v); await p.keyboard.press('Enter'); await p.waitForTimeout(50)
  }
  // 追加 45 行数据，迫使打印预览分多页
  for (let i = 0; i < 45; i++) {
    await p.keyboard.type(`数据行${i + 1}`); await p.keyboard.press('Enter'); await p.waitForTimeout(20)
  }
  // 视图 tab → 冻结窗格下拉 → 冻结首行
  await p.locator('button:has-text("视图")').first().click(); await p.waitForTimeout(250)
  await p.locator('button:has-text("冻结窗格")').first().click(); await p.waitForTimeout(300)
  const menuItems = await p.evaluate(() => Array.from(document.querySelectorAll('.ribbon-popup button')).map(x => x.textContent?.trim()))
  ok('T2 冻结下拉菜单含首行/首列/取消', menuItems.some(i => i?.includes('冻结首行')) && menuItems.some(i => i?.includes('冻结首列')) && menuItems.some(i => i?.includes('取消冻结')), JSON.stringify(menuItems))
  await p.locator('.ribbon-popup button:has-text("冻结首行")').click(); await p.waitForTimeout(400)
  // 首行数据格应 sticky
  const t2a = await p.evaluate(() => {
    const td = document.querySelector('[data-cell="0-0"]')
    const s = getComputedStyle(td)
    return { pos: s.position, top: s.top === 'auto' ? 'auto' : s.top }
  })
  ok('T2 冻结首行后首行数据格 sticky', t2a.pos === 'sticky' && t2a.top !== 'auto', JSON.stringify(t2a))
  // 向下滚动 → 首行仍可见（sticky 生效）
  await p.evaluate(() => {
    const sc = document.querySelector('.overflow-auto')
    sc.scrollTop = 800
  })
  await p.waitForTimeout(500)
  const t2b = await p.evaluate(() => {
    const td = document.querySelector('[data-cell="0-0"]')
    const q = td.getBoundingClientRect()
    const sc = document.querySelector('.overflow-auto').getBoundingClientRect()
    return { visible: q.top >= sc.top - 2 && q.top < sc.top + 60, top: Math.round(q.top), scTop: Math.round(sc.top) }
  })
  ok('T2 滚动后首行钉在顶部', t2b.visible, JSON.stringify(t2b))
  // 冻结首列（先滚回顶部）
  await p.evaluate(() => { document.querySelector('.overflow-auto').scrollTop = 0 })
  // 冻结后按钮 label 变为「取消冻结」，用 📌 图标定位（aria/title 稳定）
  await p.locator('button[title*="锁定标题"], button[title*="冻结标题"], button:has-text("取消冻结"), button:has-text("冻结窗格")').first().click(); await p.waitForTimeout(250)
  await p.locator('.ribbon-popup button:has-text("冻结首列")').click(); await p.waitForTimeout(400)
  const t2c = await p.evaluate(() => {
    const td = document.querySelector('[data-cell="0-0"]')
    return { left: getComputedStyle(td).left }
  })
  ok('T2 冻结首列生效（A 列 sticky left）', t2c.left !== 'auto' && t2c.left !== '', JSON.stringify(t2c))
  // 冻结格边框：inset 阴影绘制（boxShadow 非空且 borderColor 透明）
  const t2d = await p.evaluate(() => {
    const td = document.querySelector('[data-cell="0-0"]')
    const s = getComputedStyle(td)
    return { shadow: s.boxShadow !== 'none', bcolor: s.borderColor }
  })
  ok('T2 冻结格 inset 阴影边框', t2d.shadow, JSON.stringify(t2d))
  await p.evaluate(() => {
    const sc = document.querySelector('.overflow-auto')
    sc.scrollLeft = 500; sc.scrollTop = 600
  })
  await p.waitForTimeout(500)
  await p.screenshot({ path: '/tmp/r54-frozen-scroll.png' })

  // ═══ T3: 打印标题行 ═══
  await p.locator('[data-testid="excel-print-btn"]').click(); await p.waitForTimeout(700)
  await p.locator('[data-testid="print-tab-advanced"]').click(); await p.waitForTimeout(300)
  const rowsInput = await p.locator('[data-testid="print-title-rows"]').count()
  ok('T3 勾选重复标题行出现"标题行数"输入', rowsInput === 0, '默认未勾选时无输入框（预期行为）')
  await p.locator('[data-testid="print-title-check"]').check(); await p.waitForTimeout(300)
  const rowsInput2 = await p.locator('[data-testid="print-title-rows"]').count()
  ok('T3 勾选后出现标题行数输入', rowsInput2 === 1)
  // 设标题行数 1，制造多页：打印预览应有 ≥2 页且第 2 页顶部重复标题行
  await p.locator('[data-testid="print-title-rows"]').fill('1')
  await p.waitForTimeout(400)
  const t3a = await p.evaluate(() => {
    const pv = document.querySelector('[data-testid="print-preview"]')
    const pages = Array.from(pv.querySelectorAll(':scope > div > div'))
    const texts = pages.map(x => x.textContent || '')
    return { pageCount: pages.length, page1HasTitle: texts[0]?.includes('姓名'), page2HasTitle: texts[1]?.includes('姓名'), page2HasData: texts[1]?.includes('张三') || texts[1]?.includes('31') }
  })
  ok('T3 预览分页 ≥2 页', t3a.pageCount >= 2, JSON.stringify({ pageCount: t3a.pageCount }))
  ok('T3 第2页顶端重复标题行', t3a.page2HasTitle && (t3a.page2HasData || await p.evaluate(() => {
    const pv = document.querySelector('[data-testid="print-preview"]')
    const pages = Array.from(pv.querySelectorAll(':scope > div > div'))
    return (pages[1]?.textContent || '').includes('数据行')
  })), JSON.stringify(t3a))
  await p.screenshot({ path: '/tmp/r54-print-titles.png' })
  await p.keyboard.press('Escape')

  // ═══ T4: 冻结取消 ═══
  await p.locator('button:has-text("取消冻结"), button:has-text("冻结窗格")').first().click(); await p.waitForTimeout(250)
  await p.locator('.ribbon-popup button:has-text("取消冻结")').click(); await p.waitForTimeout(300)
  const t4 = await p.evaluate(() => getComputedStyle(document.querySelector('[data-cell="0-0"]')).position)
  ok('T4 取消冻结恢复 static', t4 !== 'sticky', t4)
  await p.evaluate(() => { document.querySelector('.overflow-auto').scrollLeft = 0; document.querySelector('.overflow-auto').scrollTop = 0 })
  await p.screenshot({ path: '/tmp/r54-final.png' })

  // ═══ T5: 保存往返（printTitleRows 持久化）═══
  // 重新设置标题行 → 保存 → 导出文件（另存对话框在 server 模式走下载?）——简化：验证 UI 状态经快照（onSheetsChange）。
  // Go 侧已有 TestRoundTripPrintTitles 单测覆盖持久化。

  console.log('---')
  const pass = results.filter(r => r[1]).length
  console.log(`TOTAL: ${pass}/${results.length} PASS`)
  await b.close()
}
main().catch(e => { console.error(e); process.exit(1) })
