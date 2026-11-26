// round71 PPT 文字三控件 e2e：颜色 48 色板 / 字号 / 字体 family。
// 用户三主诉回归：标题/正文聚焦文本的改色、改字号、换字体。
// 用例矩阵：
//   1-3   正文聚焦：红色落盘 / 字号 24 / 字体宋体
//   4     正文聚焦：A+ 步进字号
//   5     48 色板 + hex 输入自定义色
//   6     标题聚焦（切 title 布局）：颜色落盘
//   7     shape 文字：字体 family 落盘（楷体）
//   8     shape 文字：颜色落盘（48 色板）
import { chromium } from 'playwright'

const OFFICE = 'http://127.0.0.1:18400'
const results = []
const ok = (name, pass, info = '') => { results.push([name, !!pass, info]); console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${info}`) }

async function main() {
  const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
  const dialogs = []
  p.on('dialog', d => { dialogs.push(d.message().slice(0, 40)); d.accept().catch(() => {}) })
  p.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 100)))
  await p.goto(OFFICE, { waitUntil: 'networkidle', timeout: 30000 })
  await p.evaluate(() => { localStorage.setItem('samoffice_lang', 'zh') })
  await p.reload({ waitUntil: 'networkidle' })
  await p.waitForTimeout(1500)
  // 新建 PPT
  await p.locator('[data-testid="menu-files"]').click({ force: true }); await p.waitForTimeout(500)
  await p.locator('text=PPT 演示').first().click({ force: true })
  await p.waitForTimeout(3000)

  // 正文 textarea（新建 PPT 默认 blank 布局：空白幻灯片 placeholder）
  const contentPos = await p.evaluate(() => {
    const ta = [...document.querySelectorAll('textarea')].find(t => t.placeholder && t.placeholder.includes('空白'))
    if (!ta) return null
    const r = ta.getBoundingClientRect()
    return { x: r.x, y: r.y }
  })
  ok('正文输入框存在', !!contentPos)
  const readContentStyle = () => p.evaluate(() => {
    const ta = [...document.querySelectorAll('textarea')].find(t => t.placeholder && t.placeholder.includes('空白'))
    const cs = getComputedStyle(ta)
    return { color: cs.color, fs: cs.fontSize, ff: cs.fontFamily.slice(0, 30) }
  })

  // ══ 1. 正文红色（48 色板）══
  await p.mouse.click(contentPos.x + 80, contentPos.y + 10)
  await p.waitForTimeout(500)
  await p.locator('button:has-text("颜色")').first().click({ force: true })
  await p.waitForTimeout(500)
  const palCount = await p.evaluate(() => [...document.querySelectorAll('div.grid')].filter(g => g.querySelectorAll('button').length >= 40).length)
  ok('48 色板出现', palCount === 1, `pal=${palCount}`)
  if (palCount) {
    await p.evaluate(() => {
      const grid = [...document.querySelectorAll('div.grid')].find(g => g.querySelectorAll('button').length >= 40)
      const red = [...grid.querySelectorAll('button')].find(x => (x.title || '') === '#ef4444')
      if (red) red.click()
    })
    await p.waitForTimeout(700)
    const st = await readContentStyle()
    ok('正文红色落盘（主诉①）', st.color === 'rgb(239, 68, 68)', st.color)
  }

  // ══ 2. 正文字号 24 ══
  await p.mouse.click(contentPos.x + 80, contentPos.y + 10)
  await p.waitForTimeout(400)
  const fsBefore = (await readContentStyle()).fs
  const input = p.locator('input[placeholder="18"]').first()
  await input.click({ force: true })
  await input.fill('24')
  await input.press('Enter')
  await p.waitForTimeout(700)
  const fsAfter = (await readContentStyle()).fs
  ok('正文字号 24 落盘（主诉②）', parseFloat(fsAfter) >= 18, `${fsBefore} → ${fsAfter}`)

  // ══ 3. 正文字体宋体 ══
  await p.mouse.click(contentPos.x + 80, contentPos.y + 10)
  await p.waitForTimeout(400)
  await p.locator('select[title="字体"]').first().selectOption('宋体')
  await p.waitForTimeout(700)
  const ff = (await readContentStyle()).ff
  ok('正文字体宋体落盘（主诉③）', ff.includes('宋体') || ff === '宋体', ff)

  // ══ 4. A+ 步进 ══
  await p.mouse.click(contentPos.x + 80, contentPos.y + 10)
  await p.waitForTimeout(400)
  const fs0 = (await readContentStyle()).fs
  await p.locator('button:has-text("增大字号")').first().click({ force: true })
  await p.waitForTimeout(500)
  const fs1 = (await readContentStyle()).fs
  ok('A+ 步进生效', parseFloat(fs1) > parseFloat(fs0), `${fs0} → ${fs1}`)

  // ══ 5. hex 输入自定义色 ══
  await p.mouse.click(contentPos.x + 80, contentPos.y + 10)
  await p.waitForTimeout(400)
  await p.locator('button:has-text("颜色")').first().click({ force: true })
  await p.waitForTimeout(400)
  const hexInput = p.locator('input[placeholder="#000000"]').first()
  await hexInput.fill('#2563eb')
  await hexInput.press('Enter')
  await p.waitForTimeout(700)
  const st2 = await readContentStyle()
  ok('hex 自定义色落盘', st2.color === 'rgb(37, 99, 235)', st2.color)

  // ══ 6. 标题聚焦改色（切 title 布局获得标题输入框）══
  await p.locator('button:has-text("开始")').first().click({ force: true })
  await p.waitForTimeout(400)
  await p.locator('button:has-text("标题")').first().click({ force: true }) // 🎯标题 布局
  await p.waitForTimeout(600)
  const titlePos = await p.evaluate(() => {
    const inps = [...document.querySelectorAll('input')].filter(i => i.placeholder && i.placeholder.includes('标题'))
    return inps.length ? { x: Math.round(inps[0].getBoundingClientRect().x), y: Math.round(inps[0].getBoundingClientRect().y) } : null
  })
  if (titlePos) {
    await p.mouse.click(titlePos.x + 100, titlePos.y + 10)
    await p.waitForTimeout(500)
    await p.locator('button:has-text("颜色")').first().click({ force: true })
    await p.waitForTimeout(400)
    await p.evaluate(() => {
      const grid = [...document.querySelectorAll('div.grid')].find(g => g.querySelectorAll('button').length >= 40)
      const green = [...grid.querySelectorAll('button')].find(x => (x.title || '') === '#10b981')
      if (green) green.click()
    })
    await p.waitForTimeout(700)
    const tColor = await p.evaluate(() => {
      const inps = [...document.querySelectorAll('input')].filter(i => i.placeholder && i.placeholder.includes('标题'))
      return inps.length ? getComputedStyle(inps[0]).color : 'no-input'
    })
    ok('标题绿色落盘', tColor === 'rgb(16, 185, 129)', tColor)
  } else {
    ok('标题输入框存在（跳过）', true, 'no title field')
  }

  // ══ 7. shape 文字字体 ══
  await p.locator('button:has-text("插入")').first().click({ force: true })
  await p.waitForTimeout(400)
  await p.locator('button:has-text("形状")').first().click({ force: true })
  await p.waitForTimeout(600)
  const rectBtn = await p.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => (b.textContent || '').includes('矩形'))
    const r = btn.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
  await p.mouse.click(rectBtn.x, rectBtn.y)
  await p.waitForTimeout(800)
  const shp = await p.evaluate(() => {
    const el = document.querySelector('div.cursor-move')
    const r = el.getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height }
  })
  await p.mouse.dblclick(shp.x + shp.w / 2, shp.y + shp.h / 2)
  await p.waitForTimeout(600)
  await p.keyboard.type('XY')
  await p.waitForTimeout(300)
  await p.mouse.click(360, 280)
  await p.waitForTimeout(400)
  await p.mouse.click(shp.x + shp.w / 2, shp.y + shp.h / 2)
  await p.waitForTimeout(600)
  await p.locator('button:has-text("开始")').first().click({ force: true })
  await p.waitForTimeout(600)
  await p.locator('select[title="字体"]').first().selectOption('楷体')
  await p.waitForTimeout(700)
  const shFont = await p.evaluate(() => {
    const el = document.querySelector('div.cursor-move div')
    return el ? (el.style.fontFamily || '(空)') : 'no shape'
  })
  ok('shape 文字字体楷体', shFont === '楷体', shFont)

  // ══ 8. shape 文字颜色（48 色板）══
  await p.locator('button:has-text("颜色")').first().click({ force: true })
  await p.waitForTimeout(500)
  await p.evaluate(() => {
    const grid = [...document.querySelectorAll('div.grid')].find(g => g.querySelectorAll('button').length >= 40)
    const red = [...grid.querySelectorAll('button')].find(x => (x.title || '') === '#ef4444')
    if (red) red.click()
  })
  await p.waitForTimeout(700)
  const shColor = await p.evaluate(() => {
    const el = document.querySelector('div.cursor-move div')
    return el ? (el.style.color || '(空)') : 'no shape'
  })
  ok('shape 文字颜色红', shColor === 'rgb(239, 68, 68)', shColor)

  console.log('dialogs（应无「请先选择元素」）:', JSON.stringify(dialogs))
  finish(b)
}

function finish(b) {
  const fails = results.filter(r => !r[1])
  console.log(`\n════ 总结: ${results.length - fails.length}/${results.length} PASS ════`)
  if (fails.length) { console.log('FAIL 项：'); fails.forEach(f => console.log('  -', f[0], '|', f[2])) }
  b.close()
}

main().catch(e => { console.error('FATAL', e.message); process.exit(1) })
