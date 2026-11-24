// round68 探针：① Word 表格边框预设（Word 切换语义 + collapse 双侧同删）
//              ② Excel 公式引用点选（自身格提交退出 / 公式栏模式退出）
// 跑法：node scripts/e2e-web/r68_probe.mjs   （前置：bash scripts/e2e-web/_rebuild.sh）
import { chromium } from 'playwright'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.resolve(__dirname, '../../frontend/dist-web')
const FIXTURES = path.resolve(__dirname, 'fixtures')
const PORT = 8840
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.xlsx': 'application/octet-stream', '.docx': 'application/octet-stream' }
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  let file = p.startsWith('/fixtures/') ? path.join(FIXTURES, p.slice('/fixtures/'.length)) : path.join(DIST, p)
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html')
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
})
await new Promise(r => server.listen(PORT, r))

const browser = await chromium.launch()
const page = await (await browser.newContext()).newPage()
page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 200)))
page.setDefaultTimeout(20000)
const results = []
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' | ' + detail : ''}`) }

// ============ Part A：Word 表格边框 ============
// 边框编码 [top,right,bottom,left]，'1'=有线；新表未自定义 = ''（默认全有）
const wordBorders = () => page.evaluate(() => {
  const out = []
  window.__pmView.state.doc.descendants(n => {
    if (n.type.name === 'table_cell') out.push(n.attrs.borders || '')
    return true
  })
  return out
})
// 点表格工具栏的边框按钮 → 弹出菜单里点指定预设
const clickBorderPreset = async (label) => {
  const opened = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'))
    const b = btns.find(x => /边框|Border/i.test(x.title || '') && (x.textContent || '').trim() === '▦')
    if (!b) return false
    b.click()
    return true
  })
  if (!opened) return false
  await page.waitForTimeout(350)
  return await page.evaluate((lab) => {
    const items = Array.from(document.querySelectorAll('button')).filter(b => {
      const t = (b.textContent || '').trim()
      return lab.test(t.replace(/\s/g, ''))
    })
    const target = items.find(b => b.offsetParent !== null)
    if (!target) return false
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    target.click()
    return true
  }, label)
}
const tdBox = (i) => page.evaluate(idx => {
  const tds = window.__pmView.dom.querySelectorAll('table td')
  const r = tds[idx].getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
}, i)

try {
  // ---- 打开空白 Word 文档 + 3x3 表格 ----
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' })
  await page.waitForSelector('[data-testid="mode-badge"]')
  await page.waitForTimeout(600)
  await page.evaluate(() => {
    Array.from(document.querySelectorAll('button')).find(b => (b.textContent || '').includes('Files'))?.click()
  })
  await page.waitForTimeout(400)
  await page.evaluate(() => {
    Array.from(document.querySelectorAll('button')).find(b => { const t = (b.textContent || '').trim(); return t.includes('Word') || t.includes('文档') })?.click()
  })
  await page.waitForTimeout(900)
  await page.waitForSelector('.ProseMirror')
  await page.evaluate(() => {
    const v = window.__pmView
    v.dom.focus()
    const { schema } = v.state
    const rows = []
    for (let r = 0; r < 3; r++) {
      const cells = []
      for (let c = 0; c < 3; c++) cells.push(schema.nodes.table_cell.create(null, schema.nodes.paragraph.create(null, schema.text(`r${r}c${c}`))))
      rows.push(schema.nodes.table_row.create(null, cells))
    }
    v.dispatch(v.state.tr.replaceSelectionWith(schema.nodes.table.create(null, rows)))
  })
  await page.waitForTimeout(700)
  ok('Word 文档 + 3x3 表格就绪', (await wordBorders()).length === 9, '')

  // 光标放进 r1c1（index 4）
  const b4 = await tdBox(4)
  await page.mouse.click(b4.x, b4.y)
  await page.waitForTimeout(400)

  // 1. 左框线：r1c1 左边去线 + 邻居 r1c0 右边同步去线（collapse 双侧同删）
  ok('点开边框菜单-左框线', await clickBorderPreset(/左框线|LeftBorder/i), '')
  await page.waitForTimeout(400)
  let bs = await wordBorders()
  ok('左框线①：r1c1 左边去线（1110）', bs[4] === '1110', JSON.stringify(bs))
  ok('左框线①：邻居 r1c0 右边同删（1011）', bs[3] === '1011', `r1c0=${bs[3]}`)
  ok('左框线①：无关格不变', bs[0] === '' && bs[5] === '' && bs[8] === '', `r0c0=${bs[0]} r1c2=${bs[5]}`)
  // DOM 可视：r1c1 border-left 应为 none
  const cssLeft = await page.evaluate(() => getComputedStyle(window.__pmView.dom.querySelectorAll('table td')[4]).borderLeftStyle)
  ok('左框线①：DOM border-left=none', cssLeft === 'none', cssLeft)

  // 2. 再点左框线 → 加回（切换语义）
  ok('点开边框菜单-左框线②', await clickBorderPreset(/左框线|LeftBorder/i), '')
  await page.waitForTimeout(400)
  bs = await wordBorders()
  ok('左框线②：r1c1 左边加回（1111）', bs[4] === '1111', `r1c1=${bs[4]}`)

  // 3. 上框线：r1c1 顶边去线 + 上邻 r0c1 底边同删
  ok('点开边框菜单-上框线', await clickBorderPreset(/上框线|TopBorder/i), '')
  await page.waitForTimeout(400)
  bs = await wordBorders()
  ok('上框线：r1c1 顶边去线（0111）', bs[4] === '0111', `r1c1=${bs[4]}`)
  ok('上框线：上邻 r0c1 底边同删（1101）', bs[1] === '1101', `r0c1=${bs[1]}`)

  // 4. 无框线（绝对）→ 0000；5. 所有框线（绝对）→ 1111
  ok('点开边框菜单-无框线', await clickBorderPreset(/无框线|NoBorder/i), '')
  await page.waitForTimeout(400)
  bs = await wordBorders()
  ok('无框线：r1c1 → 0000', bs[4] === '0000', `r1c1=${bs[4]}`)
  ok('点开边框菜单-所有框线', await clickBorderPreset(/所有框线|AllBorders/i), '')
  await page.waitForTimeout(400)
  bs = await wordBorders()
  ok('所有框线：r1c1 → 1111', bs[4] === '1111', `r1c1=${bs[4]}`)

  // 6. 右框线：r1c1 右边去线（1011）+ 右邻 r1c2 左边同删（1110）
  ok('点开边框菜单-右框线', await clickBorderPreset(/右框线|RightBorder/i), '')
  await page.waitForTimeout(400)
  bs = await wordBorders()
  ok('右框线：r1c1 右边去线（1011）', bs[4] === '1011', `r1c1=${bs[4]}`)
  ok('右框线：右邻 r1c2 左边同删（1110）', bs[5] === '1110', `r1c2=${bs[5]}`)
} catch (e) {
  console.log('WORD-ERROR', String(e).slice(0, 300))
}

// ============ Part B：Excel 公式引用点选 ============
try {
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-testid="mode-badge"]')
  await page.evaluate(async () => {
    const buf = await (await fetch('/fixtures/r61.xlsx')).arrayBuffer()
    await window.__setFileForTest(new File([buf], 'r68.xlsx'))
  })
  await page.waitForSelector('td[data-cell="0-0"]')
  await page.waitForTimeout(800)

  // B5 编辑：输入 =SUM( → 点 A1（插入引用）→ 拖 A1:A3（扩展区间）→ ) → Enter
  const b5 = await page.evaluate(() => { const r = document.querySelector('td[data-cell="4-1"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
  await page.mouse.click(b5.x, b5.y)
  await page.waitForTimeout(400)
  await page.keyboard.type('=SUM(')
  await page.waitForTimeout(200)
  const bufRead = () => page.evaluate(() => (document.querySelector('td textarea') || document.querySelector('td input'))?.value || '')
  const a1 = await page.evaluate(() => { const r = document.querySelector('td[data-cell="0-0"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
  const a3 = await page.evaluate(() => { const r = document.querySelector('td[data-cell="2-0"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
  // Excel 流程：down(A1) 拖到 A3 up —— down 插入 A1、拖拽扩展为 A1:A3
  await page.mouse.move(a1.x, a1.y)
  await page.mouse.down()
  await page.mouse.move(a3.x, a3.y, { steps: 5 })
  await page.mouse.up()
  await page.waitForTimeout(300)
  const bufMid = await bufRead()
  ok('公式引用点选：拖拽扩展为 A1:A3', /A1:A3/.test(bufMid), bufMid)
  await page.keyboard.type(')')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(400)

  // 重新单击 B5 → 正常进入编辑，buf 应为完整公式
  await page.mouse.click(b5.x, b5.y)
  await page.waitForTimeout(400)
  let bufNow = await bufRead()
  ok('公式编辑：重新进入 B5 可编辑', bufNow === '=SUM(A1:A3)', bufNow)

  // ★ 场景1（旧 bug）：编辑中点公式格自身 → 应提交退出，绝不塞入 "B5"
  await page.mouse.click(b5.x, b5.y)
  await page.waitForTimeout(400)
  const editorGone = await page.evaluate(() => !(document.querySelector('td textarea') || document.querySelector('td input')))
  ok('场景1：点自身格 → 提交退出（编辑器关闭）', editorGone, '')
  // 再读回公式：点 C5 再点 B5（重进编辑读 buf）
  const c5 = await page.evaluate(() => { const r = document.querySelector('td[data-cell="4-2"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
  await page.mouse.click(c5.x, c5.y)
  await page.waitForTimeout(300)
  await page.mouse.click(b5.x, b5.y)
  await page.waitForTimeout(400)
  bufNow = await bufRead()
  ok('场景1：公式未被污染（无 B5）', bufNow === '=SUM(A1:A3)', bufNow)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)

  // ★ 场景2（旧 bug）：公式栏编辑 B6 → 点 A2 插引用 → 点 B6 自身 → 应 blur 退出、无 "B6"
  const b6 = await page.evaluate(() => { const r = document.querySelector('td[data-cell="5-1"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
  await page.mouse.click(b6.x, b6.y) // 选中 B6
  await page.waitForTimeout(300)
  await page.keyboard.press('Escape') // 退出可能的重编辑
  await page.click('[data-testid="formula-bar-input"]')
  await page.waitForTimeout(200)
  await page.keyboard.type('=A1')
  await page.waitForTimeout(200)
  const a2 = await page.evaluate(() => { const r = document.querySelector('td[data-cell="1-0"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
  await page.mouse.click(a2.x, a2.y) // 引用模式：公式栏路径插入 A2
  await page.waitForTimeout(300)
  let fbVal = await page.evaluate(() => document.querySelector('[data-testid="formula-bar-input"]').value)
  ok('场景2：公式栏引用点选（=A1A2）', fbVal === '=A1A2', fbVal)
  await page.mouse.click(b6.x, b6.y) // 点公式格自身 → blur 退出
  await page.waitForTimeout(300)
  const fbFocused = await page.evaluate(() => document.activeElement && document.activeElement.dataset.testid === 'formula-bar-input')
  ok('场景2：点自身格 → 公式栏失焦（引用模式退出）', !fbFocused, '')
  await page.mouse.click(b6.x, b6.y) // 重进编辑读 buf
  await page.waitForTimeout(400)
  bufNow = await bufRead()
  ok('场景2：B6 公式未被污染（=A1A2，无 B6）', bufNow === '=A1A2', bufNow)
} catch (e) {
  console.log('EXCEL-ERROR', String(e).slice(0, 300))
} finally {
  await browser.close()
  server.close()
}
const failed = results.filter(r => !r.pass).length
console.log(failed === 0 ? `\n${results.length}/${results.length} PASS` : `\n${results.length - failed}/${results.length} PASS, ${failed} FAIL`)
process.exit(failed === 0 ? 0 : 1)
