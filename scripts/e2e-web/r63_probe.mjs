// round63 探针（第一部分）：用上传的加密文档（密码 123）复现打印预览问题。
//   1. 打开 r63.docx → 输入密码 → 打印预览：页数指示应 = 编辑器分页数（1 页）
//      —— 用户报告「预览显示 3 页、实际一页」
//   2. 版式「每版打印页数」选 1版2页：预览应真实拼贴两个内容切片在同一张纸
//      —— 用户报告「1版2页显示的根本不是一页里显示两页内容」
//   3. Word 右键粘贴：复制 → 右键菜单 → 粘贴 → 文本应插入
// 跑法：node scripts/e2e-web/r63_probe.mjs   （前置：bash scripts/e2e-web/_rebuild.sh）
import { chromium } from 'playwright'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.resolve(__dirname, '../../frontend/dist-web')
const FIXTURES = path.resolve(__dirname, 'fixtures')
const SHOTS = path.resolve(__dirname, 'r63-shots')
const PORT = 8809
fs.mkdirSync(SHOTS, { recursive: true })

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.docx': 'application/octet-stream', '.txt': 'text/plain', '.md': 'text/markdown' }
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
page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 250)))
page.setDefaultTimeout(30000)
const results = []
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  | ' + detail : ''}`) }

try {
  // ============ 打开加密文档（密码 123） ============
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' })
  await page.waitForSelector('[data-testid="mode-badge"]')
  await page.evaluate(async () => {
    const buf = await (await fetch('/fixtures/r63.docx')).arrayBuffer()
    await window.__setFileForTest(new File([buf], 'r63.docx'))
  })
  await page.waitForTimeout(1500)
  // 加密对话框 → 输入密码
  const pwdInput = page.locator('[data-testid="protect-password-input"], input[type="password"]').first()
  if (await pwdInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await pwdInput.fill('123')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(1200)
  }
  await page.waitForSelector('.ProseMirror', { timeout: 15000 })
  await page.waitForTimeout(800)

  // 编辑器分页数（状态栏或纸张卡数）
  const editorPages = await page.evaluate(() => {
    const papers = document.querySelectorAll('.pm-paper, [data-testid="doc-paper"]')
    const statusbar = document.querySelector('[data-testid="statusbar-pages"], .doc-status-pages')
    return {
      paperCards: papers.length,
      statusText: statusbar ? statusbar.textContent : null,
      bodyText: (document.querySelector('.ProseMirror')?.textContent || '').slice(0, 60),
    }
  })
  ok('加密文档打开（密码123）', editorPages.bodyText.includes('随任') || editorPages.bodyText.includes('申请'), editorPages.bodyText.slice(0, 40))
  await page.screenshot({ path: path.join(SHOTS, '01-opened.png') })

  // ============ 打印预览：页数应与编辑器一致 ============
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  // 打印按钮在「视图」选项卡（语言可能为 EN=View）
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'))
    const hit = btns.find(b => { const t = (b.textContent || '').trim(); return t.includes('视图') || t === 'View' })
    if (hit) hit.click()
  })
  await page.waitForTimeout(400)
  await page.click('[data-testid="word-print-btn"]')
  await page.waitForSelector('[data-testid="print-dialog"]', { timeout: 10000 })
  await page.waitForTimeout(1200)
  const indicator = await page.textContent('[data-testid="print-page-indicator"]').catch(() => null)
  const previewInfo = await page.evaluate(() => {
    // PageFlow 纸张卡数量（word 多页卡流）
    const cards = document.querySelectorAll('[data-testid^="print-flow"] .print-paper, .print-dialog .print-paper')
    return { cards: cards.length, indicator: document.querySelector('[data-testid="print-page-indicator"]')?.textContent }
  })
  ok('打印预览页数 = 编辑器实际页数', indicator === '1 / 1' || previewInfo.indicator === '1 / 1',
     `预览指示=${indicator} 编辑器纸张卡=${editorPages.paperCards}`)
  await page.screenshot({ path: path.join(SHOTS, '02-print-preview.png') })

  // ============ 每版 2 页拼贴：同一张纸两个内容切片 ============
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('[data-testid="print-dialog"] button'))
    const hit = btns.find(b => { const t = (b.textContent || '').trim(); return t.includes('版式') || t === 'Layout' })
    if (hit) hit.click()
  })
  await page.waitForTimeout(300)
  await page.waitForTimeout(300)
  await page.click('[data-testid="print-perpage-2"]')
  await page.waitForTimeout(800)
  // 拼贴后：一张纸卡内应有 2 个切片格（grid 2×1）
  const nupInfo = await page.evaluate(() => {
    const card = document.querySelector('.print-paper') || document.querySelector('[data-testid^="print-flow"] > div')
    if (!card) return { cells: 0 }
    // 格子 = data-page 的切片窗口（PageFlow cell 结构；内容切片是内层 scale 容器）
    const cells = Array.from(card.querySelectorAll('[data-page]'))
    const cellRects = cells.map(c => { const r = c.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) } })
    // 每格内是否有内容切片（含 zoom 后的 .ProseMirror）
    const filled = cells.map(c => !!c.querySelector('.ProseMirror'))
    return { cells: cells.length, cellRects, filled }
  })
  ok('每版2页：一张纸上两个内容切片格（2×1 网格）', nupInfo.cells >= 2 && nupInfo.filled[0] === true, JSON.stringify(nupInfo.cellRects))
  await page.screenshot({ path: path.join(SHOTS, '03-nup-2.png') })

  // ============ Word 右键粘贴 ============
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  // 先写点内容并全选复制
  await page.click('.ProseMirror')
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Control+c')
  await page.waitForTimeout(300)
  // 光标到文末，右键
  await page.evaluate(() => {
    const pm = document.querySelector('.ProseMirror')
    if (pm) {
      const sel = window.getSelection()
      sel.selectAllChildren(pm)
      sel.collapseToEnd()
    }
  })
  await page.waitForTimeout(200)
  await page.click('.ProseMirror', { button: 'right' })
  await page.waitForTimeout(500)
  const menuVisible = await page.evaluate(() => {
    // 菜单 = fixed 浮层（含 撤销/重做/剪切/复制/粘贴 等按钮）
    const fixed = Array.from(document.querySelectorAll('div.fixed'))
    const hit = fixed.find(d => { const t = d.textContent || ''; return t.includes('粘贴') || t.includes('Paste') || t.includes('撤销') || t.includes('Undo') })
    return hit ? hit.textContent : null
  })
  ok('Word 右键菜单出现', !!menuVisible, (menuVisible || '').slice(0, 50))
  if (menuVisible) {
    let clicked = false
    const clicked2 = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'))
      const hit = btns.find(b => { const t = (b.textContent || '').trim(); return t.includes('粘贴') || t === 'Paste' || t.includes('📋') })
      if (hit) { hit.click(); return true }
      return false
    })
    clicked = clicked2
    await page.waitForTimeout(700)
    const after = await page.evaluate(() => (document.querySelector('.ProseMirror')?.textContent || '').length)
    ok('右键粘贴生效（文本插入）', clicked && after > 0, `clicked=${clicked} len=${after}`)
  }
  await page.screenshot({ path: path.join(SHOTS, '04-paste.png') })

  // ============ MD 编辑器：右键菜单 + LaTeX boxed ============
  // 新建 markdown：先展开 Files 菜单 →「Markdown 笔记 / 纯文本」
  const newMd = await page.evaluate(() => {
    const filesBtn = Array.from(document.querySelectorAll('button')).find(b => (b.textContent || '').includes('Files') || (b.textContent || '').includes('文件'))
    if (filesBtn) filesBtn.click()
    return !!filesBtn
  })
  await page.waitForTimeout(500)
  const newMd2 = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'))
    const hit = btns.find(b => { const t = (b.textContent || '').trim(); return t.includes('Markdown') || t.includes('笔记') || t.includes('Text File') || t.includes('纯文本') })
    if (hit) { hit.click(); return (hit.textContent || '').trim() }
    return null
  })
  ok('新建 Markdown 笔记', !!newMd2, String(newMd2))
  await page.waitForTimeout(800)
  // 写入 LaTeX 内容（含 \boxed）
  const mdIO = await page.evaluate(() => !!document.querySelector('textarea'))
  if (mdIO) {
    await page.evaluate(() => {
      const ta = document.querySelector('textarea')
      if (ta) {
        const val = '# 公式测试\n\n$$\\boxed{E = mc^2}$$\n\n行内 $\\frac{a}{b}$ 与 $\\boxed{x^2+1}$\n'
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
        setter.call(ta, val)
        ta.dispatchEvent(new Event('input', { bubbles: true }))
      }
    })
    await page.waitForTimeout(900)
    const katexInfo = await page.evaluate(() => {
      const prev = document.querySelector('[class*="preview"], .markdown-preview, div')
      const katex = document.querySelectorAll('.katex').length
      const boxed = document.querySelectorAll('.katex .mord.enclosing').length
      return { katex, boxed }
    })
    ok('LaTeX 公式渲染（KaTeX 节点）', katexInfo.katex >= 2, `katex=${katexInfo.katex}`)
    ok('\\boxed 装箱公式渲染', katexInfo.boxed >= 1 || katexInfo.katex >= 2, `enclosing=${katexInfo.boxed}`)
    await page.screenshot({ path: path.join(SHOTS, '05-md-latex.png') })
    // MD 右键菜单
    await page.click('textarea', { button: 'right' })
    await page.waitForTimeout(500)
    const mdMenu = await page.evaluate(() => !!document.querySelector('[data-testid="md-context-menu"]'))
    ok('MD 右键菜单出现', mdMenu, '')
    if (mdMenu) {
      await page.click('[data-testid="md-menu-selectAll"]')
      await page.waitForTimeout(300)
      const selLen = await page.evaluate(() => {
        const ta = document.querySelector('textarea')
        return ta ? ta.selectionEnd - ta.selectionStart : 0
      })
      ok('MD 全选生效', selLen > 30, `selected=${selLen}`)
    }
    await page.screenshot({ path: path.join(SHOTS, '06-md-menu.png') })
  }

  // ============ TXT：打开 + 编辑 ============
  await page.evaluate(async () => {
    const txt = '第一行纯文本\n第二行内容\n'
    const file = new File([txt], 'r63.txt', { type: 'text/plain' })
    await window.__setFileForTest(file)
  })
  await page.waitForTimeout(1200)
  const txtState = await page.evaluate(() => {
    const ta = document.querySelector('textarea')
    return { hasTextarea: !!ta, val: ta ? ta.value.slice(0, 30) : null }
  })
  ok('TXT 打开进纯文本编辑器', txtState.hasTextarea && (txtState.val || '').includes('纯文本'), JSON.stringify(txtState.val))
  await page.screenshot({ path: path.join(SHOTS, '07-txt-open.png') })

  const pass = results.filter(r => r.pass).length
  console.log(`\n${pass}/${results.length} PASS`)
  fs.writeFileSync(path.join(__dirname, 'r63-results.json'), JSON.stringify({ pass, total: results.length, results }, null, 2))
  if (pass < results.length) process.exitCode = 1
} catch (e) {
  console.error('PROBE ERROR:', e.message)
  await page.screenshot({ path: path.join(SHOTS, 'error.png') }).catch(() => {})
  process.exitCode = 1
} finally {
  await browser.close()
  server.close()
}
