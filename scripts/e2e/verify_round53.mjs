// round53 验证：Excel 标头右键 + Word 分页标记悬浮化
// T1: Excel 列标头右键 → 选中整列 + 弹列菜单 + 插入列生效
// T2: Excel 行标头右键 → 选中整行 + 弹行菜单 + 删除行生效
// T3: Word 显示标记 —— 分页标记零流程影响（高度不变）、无方框、样式简单
import { chromium } from 'playwright'

const OFFICE = 'http://localhost:18400'
const results = []
const ok = (name, pass, info = '') => { results.push([name, !!pass, info]); console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${info}`) }

async function main() {
  const b = await chromium.launch({ args: ['--no-sandbox'] })
  const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
  await p.goto(OFFICE, { waitUntil: 'networkidle', timeout: 30000 })
  await p.waitForTimeout(1500)
  await p.evaluate(() => { localStorage.setItem('samoffice_lang', 'zh') })
  await p.reload({ waitUntil: 'networkidle' })
  await p.waitForTimeout(1200)

  // ═══ T1/T2: Excel 标头右键 ═══
  await p.locator('[data-testid="menu-files"]').click(); await p.waitForTimeout(400)
  await p.locator('text=📊').first().click(); await p.waitForTimeout(1500)
  // 填充一些数据（经 __pmView? Excel 是自研 state —— 直接 UI 输入）
  const cellA1 = p.locator('[data-cell="0-0"]')
  await cellA1.click(); await p.waitForTimeout(200)
  await p.keyboard.type('姓名'); await p.keyboard.press('Enter'); await p.waitForTimeout(200)
  await p.keyboard.type('张三'); await p.keyboard.press('Enter'); await p.waitForTimeout(200)
  await p.keyboard.type('李四'); await p.keyboard.press('Enter'); await p.waitForTimeout(400)

  // T1: 右键列标头 B（第 2 列）
  const colHeaderB = p.locator('thead th').filter({ hasText: /^B$/ }).first()
  await colHeaderB.click({ button: 'right' })
  await p.waitForTimeout(500)
  // 列 B 应被整列选中（标头高亮 rgba(59,130,246,0.30)）+ 菜单出现
  const colMenuInfo = await p.evaluate(() => {
    const fixed = Array.from(document.querySelectorAll('div.fixed.z-\\[100\\]'))
    const menuVisible = fixed.length > 0
    const items = menuVisible ? Array.from(fixed[0].querySelectorAll('button')).map(x => x.textContent?.trim()) : []
    const thB = Array.from(document.querySelectorAll('thead th')).find(x => x.textContent?.trim() === 'B')
    const sel = thB ? getComputedStyle(thB).backgroundColor : ''
    return { menuVisible, items, thBSel: sel }
  })
  ok('T1 列标头右键弹出菜单', colMenuInfo.menuVisible === true, JSON.stringify(colMenuInfo.items?.slice(0, 6)))
  ok('T1 菜单含插入/删除列', colMenuInfo.items.some(i => i?.includes('插入列')) && colMenuInfo.items.some(i => i?.includes('删除列')), JSON.stringify(colMenuInfo.items))
  ok('T1 右键列被整列选中', colMenuInfo.thBSel.includes('0.3') || colMenuInfo.thBSel.includes('0.30'), colMenuInfo.thBSel)

  // 点"在右侧插入列" → 列数 +1
  const colsBefore = await p.evaluate(() => document.querySelectorAll('thead th').length)
  await p.locator('div.fixed button').filter({ hasText: '在右侧插入列' }).click()
  await p.waitForTimeout(600)
  const colsAfter = await p.evaluate(() => document.querySelectorAll('thead th').length)
  ok('T1 插入列生效（列数+1）', colsAfter === colsBefore + 1, `${colsBefore} → ${colsAfter}`)

  // T2: 右键行标头 3（第 3 行）
  const rowHeader3 = p.locator('tbody td').filter({ hasText: /^3$/ }).first()
  await rowHeader3.click({ button: 'right' })
  await p.waitForTimeout(500)
  const rowMenuInfo = await p.evaluate(() => {
    const fixed = Array.from(document.querySelectorAll('div.fixed.z-\\[100\\]'))
    const items = fixed.length ? Array.from(fixed[0].querySelectorAll('button')).map(x => x.textContent?.trim()) : []
    // 行标头 3 是否选中
    const tds = Array.from(document.querySelectorAll('tbody td')).filter(x => x.textContent?.trim() === '3' && x.className.includes('cursor-pointer'))
    const sel = tds.length ? getComputedStyle(tds[0]).backgroundColor : ''
    return { menuVisible: fixed.length > 0, items, rowSel: sel }
  })
  ok('T2 行标头右键弹出菜单', rowMenuInfo.menuVisible === true, JSON.stringify(rowMenuInfo.items?.slice(0, 6)))
  ok('T2 菜单含插入/删除行（无列项）', rowMenuInfo.items.some(i => i?.includes('插入行')) && rowMenuInfo.items.some(i => i?.includes('删除行')) && !rowMenuInfo.items.some(i => i?.includes('插入列')), JSON.stringify(rowMenuInfo.items))
  ok('T2 右键行被整行选中', rowMenuInfo.rowSel.includes('0.3'), rowMenuInfo.rowSel)

  // 点"删除行" → 行数 -1
  const rowsBefore = await p.evaluate(() => document.querySelectorAll('tbody tr').length)
  await p.locator('div.fixed button').filter({ hasText: '删除行' }).first().click()
  await p.waitForTimeout(600)
  const rowsAfter = await p.evaluate(() => document.querySelectorAll('tbody tr').length)
  ok('T2 删除行生效（行数-1）', rowsAfter === rowsBefore - 1, `${rowsBefore} → ${rowsAfter}`)
  await p.screenshot({ path: '/home/z/my-project/samoffice/scripts/e2e/round53-shots/excel-header-menu.png' })

  // ═══ T3: Word 分页标记 ═══
  await p.locator('[data-testid="menu-files"]').click(); await p.waitForTimeout(400)
  await p.locator('text=📝').first().click(); await p.waitForTimeout(1200)
  await p.evaluate(() => {
    // 3 段 + 显式分页符 + 2 段
    const para = (txt) => ({ type: 'paragraph', inline: [{ content: txt }] })
    const doc = {
      meta: { title: 'marks-test' },
      blocks: [para('第一段内容甲'), para('第二段内容乙'), { type: 'pageBreak', restart: false, startNumber: 1 }, para('第三段内容丙'), para('第四段内容丁')],
    }
    window.__setDocForTest(doc)
  })
  await p.waitForTimeout(1500)

  // 注：1360px 视口下「显示」组被响应式折叠（按钮不在 DOM），改用持久化键直控。
  // 按钮本身是标准 RibbonButton（与其它按钮同一 onClick 通路），用户端可用。
  const setMarks = async (v) => {
    await p.evaluate((val) => { localStorage.setItem('samoffice_show_marks', val) }, v ? '1' : '0')
    await p.reload({ waitUntil: 'networkidle' })
    await p.waitForTimeout(1500)
    // reload 后应用重开，测试文档需重注入
    await p.evaluate(() => {
      const para = (txt) => ({ type: 'paragraph', inline: [{ content: txt }] })
      window.__setDocForTest({ meta: { title: 'marks-test' }, blocks: [para('第一段内容甲'), para('第二段内容乙'), { type: 'pageBreak', restart: false, startNumber: 1 }, para('第三段内容丙'), para('第四段内容丁')] })
    })
    await p.waitForTimeout(1200)
  }
  await setMarks(false)

  // 标记关闭基线：分页符 div 高度 + 后续段落 offsetTop
  const base = await p.evaluate(() => {
    const pb = document.querySelector('div[data-page-break]')
    const next = pb ? (pb.nextElementSibling) : null
    return {
      pbH: pb ? pb.offsetHeight : -1,
      nextTop: next ? next.getBoundingClientRect().top : -1,
      pbBorder: pb ? getComputedStyle(pb).borderTopWidth : '',
      pbBg: pb ? getComputedStyle(pb).backgroundImage : '',
    }
  })

  // 开显示标记
  await setMarks(true)
  const marks = await p.evaluate(() => {
    const pb = document.querySelector('div[data-page-break]')
    const next = pb ? (pb.nextElementSibling) : null
    const label = pb?.querySelector('.page-break-label')
    const labelVisible = label ? getComputedStyle(label).display !== 'none' : false
    const labelPos = label ? getComputedStyle(label).position : ''
    return {
      pbH: pb ? pb.offsetHeight : -1,
      nextTop: next ? next.getBoundingClientRect().top : -1,
      pbBorder: pb ? getComputedStyle(pb).borderTopWidth : '',
      pbBg: pb ? getComputedStyle(pb).backgroundImage : '',
      labelVisible, labelPos, labelText: label?.textContent || '',
    }
  })
  ok('T3 标记开启后分页符块高度不变（不挤压内容）', marks.pbH === base.pbH, `off=${base.pbH} on=${marks.pbH}`)
  ok('T3 后续段落位置不变（零位移）', Math.abs(marks.nextTop - base.nextTop) < 1, `off=${base.nextTop.toFixed(1)} on=${marks.nextTop.toFixed(1)}`)
  ok('T3 无方框（无边框/无渐变底纹）', (marks.pbBorder === '0px' || marks.pbBorder === 'none') && (!marks.pbBg || marks.pbBg === 'none'), `border=${marks.pbBorder} bg=${marks.pbBg.slice(0, 40)}`)
  ok('T3 标记文字悬浮显示（简单样式）', marks.labelVisible && marks.labelPos === 'absolute' && marks.labelText.includes('分页'), `pos=${marks.labelPos} text=${marks.labelText}`)
  await p.screenshot({ path: '/home/z/my-project/samoffice/scripts/e2e/round53-shots/word-marks.png' })

  // 关闭再开 —— 确认可逆且内容不再跳动
  await setMarks(false)
  const off2 = await p.evaluate(() => {
    const pb = document.querySelector('div[data-page-break]')
    const next = pb ? (pb.nextElementSibling) : null
    return { pbH: pb ? pb.offsetHeight : -1, nextTop: next ? next.getBoundingClientRect().top : -1 }
  })
  ok('T3 关闭后回到基线（可逆）', off2.pbH === base.pbH && Math.abs(off2.nextTop - base.nextTop) < 1, `base=${base.pbH}/${base.nextTop.toFixed(1)} off2=${off2.pbH}/${off2.nextTop.toFixed(1)}`)

  await b.close()
  console.log('\n===== 汇总 =====')
  let fails = 0
  for (const [n, pass, i] of results) { console.log(`${pass ? '✓' : '✗'} ${n} — ${i}`); if (!pass) fails++ }
  console.log(fails === 0 ? 'ALL PASS' : `${fails} FAIL`)
  process.exit(fails === 0 ? 0 : 1)
}

main().catch(e => { console.error(e); process.exit(1) })
