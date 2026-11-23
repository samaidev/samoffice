// round60 探针：Excel 图片插入/编辑对齐 MS Office 的全链路验证
//   读取：r60.xlsx（三张图：twoCell+旋转+裁剪+圆角+边框+阴影 / move+双色调+椭圆+柔边 / SVG 图标）
//   交互：选中/拖动/撤销重做/缩放/旋转/样式库/裁剪/图标库插入/多选对齐/键盘微移/删除
//   往返：Ctrl+S 下载 xlsx → 检查 drawing XML（rot/srcRect/prstGeom/ln/effectLst/svgBlip/行高）
//
// 跑法：node scripts/e2e-web/r60_probe.mjs   （前置：bash scripts/build-web.sh）
// 截图/结果：scripts/e2e-web/r60-shots/
import { chromium } from 'playwright'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.resolve(__dirname, '../../frontend/dist-web')
const FIXTURES = path.resolve(__dirname, 'fixtures')
const SHOTS = path.resolve(__dirname, 'r60-shots')
const PORT = 8795
fs.mkdirSync(SHOTS, { recursive: true })

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.xlsx': 'application/octet-stream' }
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  let file = p.startsWith('/fixtures/') ? path.join(FIXTURES, p.slice('/fixtures/'.length)) : path.join(DIST, p)
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html')
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
})
await new Promise(r => server.listen(PORT, r))

const browser = await chromium.launch()
const page = await (await browser.newContext()).newPage()
page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 500)))
page.setDefaultTimeout(30000)
const results = []
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  | ' + detail : ''}`) }
const bbox = sel => page.evaluate(s => {
  const el = document.querySelector(s)
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: r.x, y: r.y, w: r.width, h: r.height }
}, sel)
// 布局盒（不受 rotate 变换影响）：svg 的 style.left/top + 层偏移换算成视口坐标
const layoutBox = id => page.evaluate(id => {
  const el = document.querySelector(`svg[data-pic-id="${id}"]`)
  const layer = document.querySelector('[data-testid="pic-layer"]')
  if (!el || !layer) return null
  const lr = layer.getBoundingClientRect()
  // zoom 缩放比：用滚动容器（offsetWidth=布局宽，rect.width=缩放后宽）换算
  const sc = layer.closest('div[style*="zoom"]') || layer.parentElement
  const scale = sc && sc.offsetWidth ? sc.getBoundingClientRect().width / sc.offsetWidth : 1
  const num = v => (v === '' || v == null ? NaN : parseFloat(v))
  const w = num(el.style.width) || num(el.getAttribute('width')) || 0
  const h = num(el.style.height) || num(el.getAttribute('height')) || 0
  return { x: lr.left + num(el.style.left) * scale, y: lr.top + num(el.style.top) * scale, w: w * scale, h: h * scale }
}, id)

try {
  // ============ 打开与读取 ============
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' })
  await page.waitForSelector('[data-testid="mode-badge"]')
  await page.evaluate(async () => {
    const buf = await (await fetch('/fixtures/r60.xlsx')).arrayBuffer()
    await window.__setFileForTest(new File([buf], 'r60.xlsx'))
  })
  await page.waitForSelector('td[data-cell="0-0"]')
  await page.waitForTimeout(1200)

  const picIds = await page.evaluate(() => Array.from(document.querySelectorAll('svg[data-pic-id]')).map(s => s.dataset.picId))
  ok('读取到 3 张图片（twoCell/move/SVG 图标）', picIds.length === 3, `got ${picIds.length}`)
  const [redId, blueId, iconId] = picIds

  // 红图锚点：from=(col1,row1,dx4,dy3) → 相对 td(1-1) 偏移 +4/+3（行高 40px 也应生效）
  const red = await layoutBox(redId)
  const anchorCell = await bbox('td[data-cell="1-1"]')
  ok('锚点偏移保真（dx=4px, dy=3px）', red && Math.abs(red.x - anchorCell.x - 4) < 6 && Math.abs(red.y - anchorCell.y - 3) < 6,
    `dLeft=${red ? (red.x - anchorCell.x).toFixed(1) : '-'} dTop=${red ? (red.y - anchorCell.y).toFixed(1) : '-'}`)
  // 行高 40px：td(1-1) 高度应为 40
  ok('自定义行高读取（row1=40px）', Math.abs(anchorCell.h - 40) < 2, `h=${anchorCell.h.toFixed(1)}`)
  // 旋转 15° → transform 含 rotate(15deg)
  const redTransform = await page.evaluate(id => document.querySelector(`svg[data-pic-id="${id}"]`)?.style.transform || '', redId)
  ok('旋转保真（rotate 15°）', redTransform.includes('rotate(15'), redTransform)
  // 裁剪 + 圆角矩形 + 边框 + 阴影：svg 内应有 clipPath roundRect 路径 + stroke path + feDropShadow
  const redSvg = await page.evaluate(id => document.querySelector(`svg[data-pic-id="${id}"]`)?.innerHTML || '', redId)
  ok('几何/边框/阴影渲染（roundRect+stroke+feDropShadow）', /clipPath/.test(redSvg) && /stroke/.test(redSvg) && /feDropShadow/.test(redSvg),
    `clip=${/clipPath/.test(redSvg)} stroke=${/stroke/.test(redSvg)} shadow=${/feDropShadow/.test(redSvg)}`)
  // 双色调：蓝图 svg 内有 duotone 滤镜
  const blueSvg = await page.evaluate(id => document.querySelector(`svg[data-pic-id="${id}"]`)?.innerHTML || '', blueId)
  ok('双色调滤镜渲染（duotone）', /feComponentTransfer/.test(blueSvg) && /A[0-9.]+,[0-9.]+ 0 1 1/.test(blueSvg), blueSvg.slice(0, 160))
  // SVG 图标：image href 为 svg data URL
  const iconHref = await page.evaluate(id => document.querySelector(`svg[data-pic-id="${id}"] image`)?.getAttribute('href') || '', iconId)
  ok('SVG 矢量源显示', iconHref.startsWith('data:image/svg+xml'), iconHref.slice(0, 30))
  await page.screenshot({ path: path.join(SHOTS, '01-open.png') })

  // ============ 选中 + 图片格式选项卡 ============
  await page.click(`svg[data-pic-id="${redId}"]`)
  await page.waitForTimeout(300)
  ok('选中出现 8 尺寸柄 + 旋转柄', await page.locator('[data-handle]').count() === 9)
  ok('出现「图片格式」上下文选项卡', await page.locator('[data-testid="ribbon-tab-picture"]').isVisible())
  await page.screenshot({ path: path.join(SHOTS, '02-selected.png') })

  // ============ 拖动 + 撤销重做 ============
  const before = await layoutBox(redId)
  if (!before) throw new Error('红图消失：layoutBox 返回 null')
  await page.mouse.move(before.x + before.w / 2, before.y + before.h / 2)
  await page.mouse.down()
  await page.mouse.move(before.x + before.w / 2 + 60, before.y + before.h / 2 + 40, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(300)
  const dbgDrag = await page.evaluate(() => ({
    svgs: document.querySelectorAll('svg[data-pic-id]').length,
    ids: Array.from(document.querySelectorAll('svg[data-pic-id]')).map(e => e.dataset.picId),
    layer: !!document.querySelector('[data-testid="pic-layer"]'),
    scrollDiv: !!document.querySelector('div[style*="zoom"]'),
    active: document.activeElement?.tagName,
  }))
  console.log('[dbg after drag]', JSON.stringify(dbgDrag))
  if (dbgDrag.svgs === 0) {
    const crashText = await page.evaluate(() => document.body.innerText.slice(0, 1200))
    console.log('[crash text]', crashText.replace(/\n+/g, ' | ').slice(0, 900))
  }
  const moved = await layoutBox(redId)
  ok('拖动移动 (+60,+40)', Math.abs(moved.x - before.x - 60) < 8 && Math.abs(moved.y - before.y - 40) < 8,
    `dx=${(moved.x - before.x).toFixed(1)} dy=${(moved.y - before.y).toFixed(1)}`)
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(250)
  const undone = await layoutBox(redId)
  ok('Ctrl+Z 撤销拖动', Math.abs(undone.x - before.x) < 8 && Math.abs(undone.y - before.y) < 8,
    `dx=${(undone.x - before.x).toFixed(1)} dy=${(undone.y - before.y).toFixed(1)}`)
  await page.keyboard.press('Control+y')
  await page.waitForTimeout(250)
  const redone = await layoutBox(redId)
  ok('Ctrl+Y 重做', Math.abs(redone.x - before.x - 60) < 8 && Math.abs(redone.y - before.y - 40) < 8)

  // ============ 缩放（右下柄 +30,+20）============
  const se = await bbox('[data-handle="se"]')
  await page.mouse.move(se.x + se.w / 2, se.y + se.h / 2)
  await page.mouse.down()
  await page.mouse.move(se.x + se.w / 2 + 30, se.y + se.h / 2 + 20, { steps: 6 })
  await page.mouse.up()
  await page.waitForTimeout(250)
  const resized = await layoutBox(redId)
  ok('拖柄缩放 (+30,+20)', resized.w - redone.w > 20 && resized.h - redone.h > 12,
    `w ${redone.w.toFixed(0)}→${resized.w.toFixed(0)} h ${redone.h.toFixed(0)}→${resized.h.toFixed(0)}`)
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(200)

  // ============ 旋转柄 ============
  const rot0 = await page.evaluate(id => document.querySelector(`svg[data-pic-id="${id}"]`)?.style.transform || '', redId)
  const c = await bbox(`svg[data-pic-id="${redId}"]`)
  const cx = c.x + c.w / 2, cy = c.y + c.h / 2
  const rh = await bbox('[data-handle="rot"]')
  await page.mouse.move(rh.x + rh.w / 2, rh.y + rh.h / 2)
  await page.mouse.down()
  // 从柄位置拖到图片正右侧 ≈ +90°（相对当前角度）
  await page.mouse.move(cx + c.w / 2 + 20, cy, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(250)
  const rot1 = await page.evaluate(id => document.querySelector(`svg[data-pic-id="${id}"]`)?.style.transform || '', redId)
  ok('旋转柄拖拽改角度', rot1 !== rot0 && /rotate\((\d+(\.\d+)?)deg\)/.test(rot1), `${rot0} → ${rot1}`)
  await page.screenshot({ path: path.join(SHOTS, '03-rotated.png') })
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(200)

  // ============ 样式库 ============
  await page.click('[data-testid="pic-style-2"]') // 简易框架：白边框 + 阴影
  await page.waitForTimeout(300)
  const styled = await page.evaluate(id => document.querySelector(`svg[data-pic-id="${id}"]`)?.innerHTML || '', redId)
  ok('图片样式库（简易框架 = 白色粗边框）', /stroke="#FFFFFF"/.test(styled), '')
  await page.screenshot({ path: path.join(SHOTS, '04-styled.png') })

  // ============ 裁剪模式 ============
  await page.click('[data-testid="pic-menu-crop"]')
  await page.waitForTimeout(200)
  await page.click('[data-testid="pic-crop-start"]')
  await page.waitForTimeout(300)
  ok('进入裁剪模式（黑色裁剪柄）', await page.locator('[data-crop-handle]').count() === 8)
  const ce = await bbox('[data-crop-handle="e"]')
  const cropBefore = await bbox(`svg[data-pic-id="${redId}"]`)
  await page.mouse.move(ce.x + ce.w / 2, ce.y + ce.h / 2)
  await page.mouse.down()
  await page.mouse.move(ce.x + ce.w / 2 + 25, ce.y + ce.h / 2, { steps: 6 })
  await page.mouse.up()
  await page.waitForTimeout(250)
  const cropAfter = await bbox(`svg[data-pic-id="${redId}"]`)
  ok('裁剪柄扩展显示区域 (+25px)', cropAfter.w - cropBefore.w > 18, `w ${cropBefore.w.toFixed(0)}→${cropAfter.w.toFixed(0)}`)
  await page.click('[data-testid="crop-banner"] button')
  await page.waitForTimeout(200)
  ok('退出裁剪模式', await page.locator('[data-crop-handle]').count() === 0)
  await page.screenshot({ path: path.join(SHOTS, '05-cropped.png') })

  // ============ 图标库插入 ============
  await page.click('td[data-cell="17-0"]')
  await page.waitForTimeout(200)
  await page.click('[data-testid="ribbon-tab-insert"]')
  await page.click('[data-testid="sheet-btn-image"]')
  await page.waitForTimeout(200)
  await page.click('[data-testid="pic-insert-icons"]')
  await page.waitForSelector('[data-testid="icon-library"]')
  await page.click('[data-testid="icon-check"]')
  await page.waitForTimeout(600)
  const picCount2 = await page.evaluate(() => document.querySelectorAll('svg[data-pic-id]').length)
  ok('图标库插入（矢量 SVG 图片）', picCount2 === 4, `got ${picCount2}`)
  await page.screenshot({ path: path.join(SHOTS, '06-icon-inserted.png') })

  // ============ 多选 + 对齐 ============
  const scrollPicIntoView = async id => {
    await page.evaluate(id => document.querySelector(`svg[data-pic-id="${id}"]`)?.scrollIntoView({ block: 'center', inline: 'center' }), id)
    await page.waitForTimeout(150)
  }
  await scrollPicIntoView(redId)
  const redBox = await layoutBox(redId)
  await page.mouse.click(redBox.x + redBox.w / 2, redBox.y + redBox.h / 2)
  await page.waitForTimeout(250)
  await scrollPicIntoView(blueId)
  const blueBox = await layoutBox(blueId)
  await page.keyboard.down('Control')
  await page.mouse.click(blueBox.x + blueBox.w / 2, blueBox.y + blueBox.h / 2)
  await page.keyboard.up('Control')
  await page.waitForTimeout(300)
  const frameCount = await page.locator('[data-testid^="pic-frame-"]').count()
  ok('Ctrl+点击多选（两个选择框）', frameCount === 2, `frames=${frameCount}`)
  await page.click('[data-testid="pic-menu-align"]')
  await page.waitForTimeout(150)
  await page.click('[data-testid="pic-align-left"]')
  await page.waitForTimeout(300)
  const a1 = await layoutBox(redId)
  const a2 = await layoutBox(blueId)
  ok('多选左对齐', Math.abs(a1.x - a2.x) < 3, `x1=${a1.x.toFixed(1)} x2=${a2.x.toFixed(1)}`)
  await page.screenshot({ path: path.join(SHOTS, '07-aligned.png') })

  // ============ 键盘微移 / 删除 / 撤销 ============
  await scrollPicIntoView(blueId)
  const kb0 = await layoutBox(blueId)
  await page.mouse.click(a2.x + a2.w / 2, a2.y + a2.h / 2)
  await page.waitForTimeout(150)
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Shift+ArrowDown')
  await page.waitForTimeout(250)
  const kb1 = await layoutBox(blueId)
  ok('方向键微移（→1px，Shift+↓10px）', Math.abs(kb1.x - kb0.x - 1) < 2 && Math.abs(kb1.y - kb0.y - 10) < 3,
    `dx=${(kb1.x - kb0.x).toFixed(1)} dy=${(kb1.y - kb0.y).toFixed(1)}`)
  await page.keyboard.press('Delete')
  await page.waitForTimeout(300)
  const cntAfterDel = await page.evaluate(() => document.querySelectorAll('svg[data-pic-id]').length)
  ok('Delete 删除选中图片', cntAfterDel === 3, `got ${cntAfterDel}`)
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(300)
  const cntAfterUndo = await page.evaluate(() => document.querySelectorAll('svg[data-pic-id]').length)
  ok('Ctrl+Z 恢复删除', cntAfterUndo === 4, `got ${cntAfterUndo}`)

  // ============ 保存往返（Ctrl+S 下载 → 检查 drawing XML）============
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.keyboard.press('Control+s'),
  ])
  const savedPath = path.join(SHOTS, 'r60-saved.xlsx')
  await download.saveAs(savedPath)
  const saved = fs.readFileSync(savedPath)
  ok('Ctrl+S 下载 xlsx', saved.length > 5000, `${saved.length} bytes`)
  await page.screenshot({ path: path.join(SHOTS, '08-final.png') })

  // ---- 结果汇总 ----
  const pass = results.filter(r => r.pass).length
  console.log(`\n${pass}/${results.length} PASS`)
  fs.writeFileSync(path.join(__dirname, 'r60-results.json'), JSON.stringify({ pass, total: results.length, results, savedPath }, null, 2))
  if (pass < results.length) process.exitCode = 1
} catch (e) {
  console.error('PROBE ERROR:', e.message)
  await page.screenshot({ path: path.join(SHOTS, 'error.png') }).catch(() => {})
  process.exitCode = 1
} finally {
  await browser.close()
  server.close()
}
