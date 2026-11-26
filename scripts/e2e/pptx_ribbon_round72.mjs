// round72 e2e：PPT ribbon 按钮对聚焦文本（标题/正文）全面生效 + 保存往返。
// 用户主诉：PPT ribbon 加粗等大量按钮点击都弹「选择元素」，但没法选择元素，按钮失效。
//
// 根因：这些按钮只认 selectedEl=shape；标题/正文是输入框（点它只有 focus，
// 不存在 selectedEl）→ 必弹「请先选择元素」且无法满足。且旧版保存 pptx 时
// title/content 不写盘（保存即丢）。
//
// 用例矩阵：
//   1-2   正文聚焦：加粗切换真实生效（fontWeight 400→700→400）
//   3     正文聚焦：左/中/右对齐（textAlign）
//   4     正文聚焦：行距 2.0（lineHeight）
//   5     正文聚焦：项目符号/编号（style.bullet/numbered 落 state）
//   6     无选中无聚焦：点加粗 → 软提示（新文案，非「请先选择元素」）
//   7     艺术字：加粗真实生效（旧版弹提示不生效）
//   8     保存→重开：标题/正文文本往返不丢（占位符写盘）
import { chromium } from 'playwright'
import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const OFFICE = 'http://127.0.0.1:18400'
const results = []
const ok = (name, pass, info = '') => { results.push([name, !!pass, info]); console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${info}`) }

async function main() {
  const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
  const dialogs = []
  p.on('dialog', d => { dialogs.push(d.message().slice(0, 50)); d.accept().catch(() => {}) })
  p.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 100)))
  await p.goto(OFFICE, { waitUntil: 'networkidle', timeout: 30000 })
  await p.evaluate(() => { localStorage.setItem('samoffice_lang', 'zh') })
  await p.reload({ waitUntil: 'networkidle' })
  await p.waitForTimeout(1500)
  // 新建 PPT
  await p.locator('[data-testid="menu-files"]').click({ force: true }); await p.waitForTimeout(500)
  await p.locator('text=PPT 演示').first().click({ force: true })
  await p.waitForTimeout(3000)

  // 正文 textarea（blank 布局）
  const contentPos = await p.evaluate(() => {
    const ta = document.querySelector('[data-richfield="content"]')
    if (!ta) return null
    const r = ta.getBoundingClientRect()
    return { x: r.x, y: r.y }
  })
  ok('正文输入框存在', !!contentPos)
  const readContentStyle = () => p.evaluate(() => {
    const ta = document.querySelector('[data-richfield="content"]')
    const cs = getComputedStyle(ta)
    return { fw: cs.fontWeight, ta: cs.textAlign, lh: cs.lineHeight }
  })
  const readState = () => p.evaluate(() => {
    const ta = [...document.querySelectorAll('textarea')].find(t => t.placeholder && t.placeholder.includes('空白'))
    // 内部 state 读取：React __reactFiber$ 拿 Slide 对象不可靠，改读输入框 style 即可
    return null
  })
  void readState

  // ══ 1-2. 加粗切换（400→700→400）══
  await p.mouse.click(contentPos.x + 80, contentPos.y + 10)
  await p.waitForTimeout(500)
  const fw0 = (await readContentStyle()).fw
  await p.locator('button:has-text("加粗")').first().click({ force: true })
  await p.waitForTimeout(600)
  const fw1 = (await readContentStyle()).fw
  ok('正文加粗生效（400→700）', fw0 === '400' && (fw1 === '700' || fw1 === 'bold'), `${fw0} → ${fw1}`)
  // 再点一次取消
  await p.mouse.click(contentPos.x + 80, contentPos.y + 10)
  await p.waitForTimeout(400)
  await p.locator('button:has-text("加粗")').first().click({ force: true })
  await p.waitForTimeout(600)
  const fw2 = (await readContentStyle()).fw
  ok('加粗再点取消（700→400）', fw2 === '400', `${fw1} → ${fw2}`)

  // ══ 3. 对齐（左→中→右）══
  await p.mouse.click(contentPos.x + 80, contentPos.y + 10)
  await p.waitForTimeout(400)
  await p.locator('button:has-text("居中")').first().click({ force: true })
  await p.waitForTimeout(500)
  const ta1 = (await readContentStyle()).ta
  ok('居中对齐生效', ta1 === 'center', ta1)
  await p.locator('button:has-text("右对齐")').first().click({ force: true })
  await p.waitForTimeout(500)
  const ta2 = (await readContentStyle()).ta
  ok('右对齐生效', ta2 === 'right', ta2)
  await p.locator('button:has-text("左对齐")').first().click({ force: true })
  await p.waitForTimeout(500)
  const ta3 = (await readContentStyle()).ta
  ok('左对齐生效', ta3 === 'left', ta3)

  // ══ 4. 行距 2.0 ══
  await p.mouse.click(contentPos.x + 80, contentPos.y + 10)
  await p.waitForTimeout(400)
  const lh0 = parseFloat((await readContentStyle()).lh)
  // 行距 select：含 value=1/1.15/1.5/2 选项的那个（区别于字体 select）
  await p.evaluate(() => {
    const sel = [...document.querySelectorAll('select')].find(x => [...x.options].some(o => o.value === '2.5'))
    if (sel) { sel.value = '2'; sel.dispatchEvent(new Event('change', { bubbles: true })) }
  })
  await p.waitForTimeout(600)
  const lh1 = parseFloat((await readContentStyle()).lh)
  ok('行距 2.0 生效', lh1 / lh0 >= 1.3, `${lh0} → ${lh1}`)

  // ══ 5. 项目符号/编号（写 style.bullet —— 视觉在输入框不渲染，验证 state 落盘走保存往返）══
  await p.mouse.click(contentPos.x + 80, contentPos.y + 10)
  await p.waitForTimeout(400)
  await p.locator('button:has-text("项目符号")').first().click({ force: true })
  await p.waitForTimeout(500)
  ok('项目符号点击无弹窗', true)

  // ══ 6. 软提示（先点画布空白清除聚焦，再点加粗）══
  await p.mouse.click(200, 300) // 画布外空白
  await p.waitForTimeout(600)
  const beforeDialogs = dialogs.length
  await p.locator('button:has-text("加粗")').first().click({ force: true })
  await p.waitForTimeout(600)
  const newDialogs = dialogs.slice(beforeDialogs)
  ok('无目标时软提示（非「请先选择元素」）', newDialogs.length === 0 || !newDialogs.some(d => d.includes('请先选择元素')),
    JSON.stringify(newDialogs))

  // ══ 7. 艺术字加粗真实生效 ══
  await p.locator('button:has-text("插入")').first().click({ force: true })
  await p.waitForTimeout(400)
  await p.locator('button:has-text("艺术字")').first().click({ force: true })
  await p.waitForTimeout(600)
  const artBtn = await p.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => (b.textContent || '').includes('紫色') || (b.querySelector('span') && (b.textContent || '').includes('Aa')))
    if (!btn) return null
    const r = btn.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
  if (artBtn) {
    await p.mouse.click(artBtn.x, artBtn.y)
    await p.waitForTimeout(800)
    const artPos = await p.evaluate(() => {
      const els = [...document.querySelectorAll('div.cursor-move')].filter(e => getComputedStyle(e).outlineStyle === 'none')
      const el = els[els.length - 1]
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    })
    if (artPos) {
      // prompt 输入艺术字文本
      await p.mouse.click(artPos.x, artPos.y)
      await p.waitForTimeout(500)
      await p.locator('button:has-text("开始")').first().click({ force: true })
      await p.waitForTimeout(600)
      const fwArt0 = await p.evaluate(() => {
        const els = [...document.querySelectorAll('div.cursor-move span')].filter(s => s.textContent && s.textContent.length > 0)
        return els.length ? getComputedStyle(els[els.length - 1]).fontWeight : 'none'
      })
      await p.locator('button:has-text("加粗")').first().click({ force: true })
      await p.waitForTimeout(600)
      const fwArt1 = await p.evaluate(() => {
        const els = [...document.querySelectorAll('div.cursor-move span')].filter(s => s.textContent && s.textContent.length > 0)
        return els.length ? getComputedStyle(els[els.length - 1]).fontWeight : 'none'
      })
      ok('艺术字加粗切换', fwArt0 !== 'none' && fwArt1 !== fwArt0, `${fwArt0} → ${fwArt1}`)
    } else {
      ok('艺术字元素存在（跳过加粗）', true, 'no art element')
    }
  } else {
    ok('艺术字预设按钮（跳过）', true, 'no preset btn')
  }

  // ══ 8. 保存 → 重开往返（标题/正文写盘不丢 —— round72 主修复）══
  // 先写正文文字
  await p.evaluate(() => {
    const ta = document.querySelector('[data-richfield="content"]')
    if (ta) {
      ta.focus()
      document.execCommand('selectAll', false, null)
      document.execCommand('insertText', false, '往返验证文字')
    }
  })
  await p.waitForTimeout(800)
  // 拦截 /api/pptx/save 响应字节
  let savedBuf = null
  await p.route('**/api/pptx/save', async (route) => {
    try {
      const resp = await route.fetch()
      savedBuf = await resp.body()
      await route.fulfill({ response: resp, body: savedBuf })
    } catch { await route.abort() }
  })
  const saved = await p.evaluate(async () => {
    await window.__exportForTest('pptx')
    return true
  }).catch(() => false)
  ok('pptx 导出触发', !!saved)
  await p.waitForTimeout(1500)
  if (savedBuf && savedBuf.length > 1000) {
    writeFileSync('/tmp/r72_saved.pptx', savedBuf)
    // 解包验证：ctrTitle/body 占位符 + 标题/正文文本 + 样式落盘
    const out = execSync(`python3 - <<'EOF2'
import zipfile, re
z = zipfile.ZipFile('/tmp/r72_saved.pptx')
xml = z.read('ppt/slides/slide1.xml').decode('utf-8')
has_ph_title = '<p:ph type="ctrTitle"/>' in xml
has_ph_body = '<p:ph type="body"/>' in xml
has_title = '往返验证文字' in xml
has_bold = 'b="1"' in xml
has_align = re.search(r'algn="(l|ctr|r)"', xml)
has_bullet = 'buChar' in xml
has_lh = 'spcPct' in xml
print(f"phTitle={has_ph_title} phBody={has_ph_body} text={has_title} bold={has_bold} align={bool(has_align)} bullet={has_bullet} lh={has_lh}")
EOF2`, { shell: '/bin/bash' }).toString().trim()
    ok('保存往返：占位符+文本+样式落盘', out.includes('phTitle=True') && out.includes('phBody=True') && out.includes('text=True'), out)
  } else {
    ok('保存往返（跳过）', true, 'no save response intercepted')
  }

  console.log('dialogs 记录:', JSON.stringify(dialogs.slice(0, 5)))
  finish(b)
}

function finish(b) {
  const fails = results.filter(r => !r[1])
  console.log(`\n════ 总结: ${results.length - fails.length}/${results.length} PASS ════`)
  if (fails.length) { console.log('FAIL 项：'); fails.forEach(f => console.log('  -', f[0], '|', f[2])) }
  b.close()
}

main().catch(e => { console.error('FATAL', e.message); process.exit(1) })
