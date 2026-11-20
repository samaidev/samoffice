// e2e_round48.mjs — 列表 toggle 取消 + 自定义编号格式 E2E
// 验证：
//   1) 有序列表按钮二次点击取消列表（UDM/无序列表残留）
//   2) 无序列表按钮同样 toggle
//   3) 序号按钮激活态（列表中时高亮）
//   4) 自定义编号格式对话框：中文一二三（chineseCounting）+ 前缀“第”+ 后缀“条” + 起始号 3
//   5) 保存 → 重新打开：样式串与起始号往返保真（numbering.xml numFmt/lvlText/startOverride）
import { chromium } from 'playwright'
import { mkdirSync } from 'fs'

const BASE = 'http://127.0.0.1:18400'
const SHOTS = '/home/z/my-project/samoffice/scripts/e2e/round48-shots'
mkdirSync(SHOTS, { recursive: true })
const results = []
const ok = (name, pass, info = '') => results.push([name, !!pass, String(info).slice(0, 140)])

async function main() {
  const browser = await chromium.launch({ args: ['--no-sandbox'] })
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))

  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(1500)
  await page.evaluate(() => { localStorage.setItem('samoffice_lang', 'zh') })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)

  // 注入 3 段文本文档
  await page.evaluate(() => {
    const mk = (t) => ({ inline: [{ content: t }], style: '', align: '' })
    window.__setDocForTest({ blocks: [mk('第一项'), mk('第二项'), mk('第三项')] })
  })
  await page.waitForSelector('.ProseMirror', { timeout: 15000 })
  await page.waitForTimeout(600)
  const sel = page.locator('.ProseMirror')
  await sel.click()
  await page.keyboard.type('甲')
  await page.keyboard.press('Enter')
  await page.keyboard.type('乙')
  await page.keyboard.press('Enter')
  await page.keyboard.type('丙')

  // ---------- 1) 全选 → 应用有序列表 ----------
  await page.keyboard.press('Control+a')
  const olBtn = page.locator('button[title="有序列表"]')
  await olBtn.click()
  await page.waitForTimeout(500)
  let olCount = await page.locator('.ProseMirror ol').count()
  ok('有序列表创建', olCount === 1, `ol=${olCount}`)

  // ---------- 2) 按钮激活态 ----------
  // 光标放进列表第一项文本内（点第一行文本），激活态应亮
  const firstLi = page.locator('.ProseMirror ol li p').first()
  await firstLi.click()
  await page.waitForTimeout(400)
  const active = await olBtn.evaluate(el => el.classList.contains('active'))
  ok('序号按钮激活态', active, String(active))

  // ---------- 3) 二次点击：取消列表 ----------
  await olBtn.click()
  await page.waitForTimeout(500)
  olCount = await page.locator('.ProseMirror ol, .ProseMirror ul').count()
  const textAfter = await sel.innerText()
  ok('二次点击取消列表', olCount === 0 && textAfter.includes('甲'), `lists=${olCount}, text=${textAfter.replace(/\n/g, '|').slice(0, 60)}`)

  // ---------- 4) 无序列表 toggle ----------
  await page.keyboard.press('Control+a')
  const ulBtn = page.locator('button[title="无序列表"]')
  await ulBtn.click()
  await page.waitForTimeout(400)
  const ulCount = await page.locator('.ProseMirror ul').count()
  await ulBtn.click()
  await page.waitForTimeout(400)
  const ulAfter = await page.locator('.ProseMirror ul').count()
  ok('无序列表 toggle', ulCount === 1 && ulAfter === 0, `ul=${ulCount}→${ulAfter}`)

  // ---------- 5) 自定义编号格式：第N条（中文一二三，起始 3） ----------
  await page.keyboard.press('Control+a')
  await olBtn.click()
  await page.waitForTimeout(400)

  // 打开序号样式下拉 → 定义新编号格式
  await page.click('[data-testid="numbering-style"]')
  await page.waitForTimeout(500)
  await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('.ribbon-popup button, .ribbon-popup div, [role=menu] button'))
    const el = items.find(b => (b.textContent || '').includes('定义新编号格式'))
    if (el) el.click(); else window.__noCustom = items.map(i => i.textContent).join(',').slice(0, 200)
  })
  await page.waitForTimeout(500)
  const dialogVisible = await page.locator('.modal').count()
  ok('自定义编号对话框打开', dialogVisible > 0, dialogVisible > 0 ? '' : await page.evaluate(() => window.__noCustom || 'no dialog'))

  if (dialogVisible) {
    // 数字样式下拉 → 中文 一, 二, 三
    const fmtDrop = page.locator('.modal .ribbon-input').first()
    await fmtDrop.click()
    await page.waitForTimeout(400)
    await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('.ribbon-popup button, .ribbon-popup div'))
      const el = items.find(b => (b.textContent || '').includes('一, 二, 三'))
      if (el) el.click()
    })
    await page.waitForTimeout(300)

    // 前缀 第 / 后缀 条 / 起始 3
    const inputs = page.locator('.modal input[type=text]')
    await inputs.nth(0).fill('第')
    await inputs.nth(1).fill('条')
    await page.locator('.modal input[type=number]').fill('3')

    const previewText = await page.locator('.modal').innerText()
    ok('预览含"第三条"', previewText.includes('第三条'), previewText.slice(0, 160).replace(/\n/g, '|'))

    await page.locator('.modal button:has-text("确定")').click()
    await page.waitForTimeout(600)

    const tmpl = await page.evaluate(() => {
      const ol = document.querySelector('.ProseMirror ol.num-tmpl')
      if (!ol) return null
      return { cls: ol.className, style: ol.getAttribute('style') || '' }
    })
    ok('自定义模板渲染', !!tmpl && tmpl.cls.includes('num-fmt-cjk'), JSON.stringify(tmpl))

    await page.screenshot({ path: `${SHOTS}/custom-num.png` })
  }

  // ---------- 6) 保存（Files 菜单 → 💾）→ 重新打开 ----------
  let savedBuf = null
  await page.route('**/api/doc/save', async (route) => {
    try {
      const resp = await route.fetch()
      savedBuf = await resp.body()
      await route.fulfill({ response: resp, body: savedBuf })
    } catch { await route.abort() }
  })
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'))
    const menuBtn = btns.find(b => /Files|文件/i.test(b.textContent || ''))
    if (menuBtn) menuBtn.click()
  })
  await page.waitForTimeout(500)
  await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('button, div'))
    const save2 = items.find(b => (b.textContent || '').trim().startsWith('💾'))
    if (save2) save2.click()
  })
  await page.waitForTimeout(4000)

  if (savedBuf && savedBuf.length > 1000) {
    const form = new FormData()
    form.append('file', new Blob([savedBuf]), 'rt.docx')
    const r = await fetch(`${BASE}/api/doc/open`, { method: 'POST', body: form })
    const j = await r.json()
    const blocks = (j.document && j.document.blocks) || []
    const lists = blocks.filter(b => b.items && b.ordered)
    const lst = lists[0] || {}
    ok('往返: 有序列表保留', lists.length === 1, `lists=${lists.length}`)
    ok('往返: 样式串', lst.style === 'chineseCounting|第%1条', lst.style)
    ok('往返: 起始号 3', Number(lst.start) === 3, `start=${lst.start}`)
  } else {
    ok('保存往返', false, `savedBuf=${savedBuf ? savedBuf.length : 'null'}`)
  }

  await page.screenshot({ path: `${SHOTS}/final.png` })

  console.log('\n=== round48 E2E 结果 ===')
  let fail = 0
  for (const [name, pass, info] of results) {
    console.log(`${pass ? '✓' : '✗'} ${name}${pass ? '' : ' —— ' + info}`)
    if (!pass) fail++
  }
  if (errors.length) console.log('pageerror:', errors.slice(0, 3))
  console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}`)
  await browser.close()
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(e => { console.error(e); process.exit(2) })
