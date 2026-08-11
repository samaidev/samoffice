import { chromium } from 'playwright'

const URL = 'http://localhost:5173'
const DOC = 'C:/samoffice/build/long_para.docx'
const OUT = 'c:/samoffice/scripts/pagination_test.png'

function assert(cond, msg) {
  console.log((cond ? 'PASS: ' : 'FAIL: ') + msg)
  if (!cond) process.exitCode = 1
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push('PAGEERR: ' + e.message))

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(2000)

// 等待后端 API 可用
await page.waitForFunction(
  () => !!(window.go && window.go.main && window.go.main.App && window.go.main.App.OpenFile),
  {},
  { timeout: 15000 },
)
console.log('WAILS_API_READY: true')

// 打开一个 docx 文件进入文档编辑器
const openRes = await page.evaluate(async (docPath) => {
  try {
    return await window.go.main.App.OpenFile(docPath)
  } catch (e) {
    return { error: String(e) }
  }
}, DOC)
console.log('OPEN_RESULT:', JSON.stringify(openRes, null, 1).slice(0, 400))

// 轮询最多 12 秒，检查 .ProseMirror 是否出现
let editorUp = false
for (let i = 0; i < 24; i++) {
  editorUp = await page.evaluate(() => {
    const pm = document.querySelector('.ProseMirror')
    return !!(pm && pm.children.length > 0)
  })
  if (editorUp) break
  await page.waitForTimeout(500)
}
console.log('EDITOR_OPENED:', editorUp)
if (!editorUp) {
  const diag = await page.evaluate(() => ({
    hasPM: !!document.querySelector('.ProseMirror'),
    bodyText: (document.body.innerText || '').slice(0, 300),
    activeText: (document.querySelector('#root')?.innerText || '').slice(0, 300),
  }))
  console.log('DIAG:', JSON.stringify(diag))
  console.log('ERRORS:', errors.slice(0, 10).join('\n'))
  await browser.close()
  process.exit(1)
}
await page.waitForTimeout(800)

// 全选并替换为一个超长单段落
const longText = ('这是一段用于分页引擎自测的普通中文文本，用来验证段落是否能正确跨页拆分。')
  .repeat(180)
await page.click('.ProseMirror')
await page.keyboard.press('Control+a')
await page.waitForTimeout(200)
await page.evaluate((t) => {
  document.execCommand('insertText', false, t)
}, longText)
await page.waitForTimeout(1500)

// 读取分页结果
const data = await page.evaluate(() => {
  const pm = document.querySelector('.ProseMirror')
  // 纸页背景 div：border-radius 8px + 绝对定位 + 宽 ~794
  const pages = Array.from(document.querySelectorAll('div')).filter((d) => {
    const s = d.style
    return s.borderRadius === '8px' && s.position === 'absolute' && parseInt(s.width || '0') > 300
  }).map((d) => {
    const r = d.getBoundingClientRect()
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), width: parseInt(d.style.width) }
  }).sort((a, b) => a.top - b.top)

  const linebreaks = Array.from(document.querySelectorAll('.pg-linebreak'))

  const paras = Array.from(pm.children).filter((c) => c.tagName === 'P')
  const para = paras[0]
  const pRect = para ? para.getBoundingClientRect() : null
  // 段落内各行（首尾采样）
  let rows = []
  if (para) {
    const range = document.createRange()
    let lastTop = -999
    const walk = (n) => {
      if (n.nodeType === Node.TEXT_NODE) {
        const txt = n.textContent || ''
        for (let i = 0; i < txt.length; i++) {
          range.setStart(n, i); range.setEnd(n, i + 1)
          const rb = range.getBoundingClientRect()
          const top = Math.round(rb.top)
          const bottom = Math.round(rb.bottom)
          if (top !== lastTop) { rows.push({ top, bottom }); lastTop = top }
        }
      } else {
        for (const c of Array.from(n.childNodes)) walk(c)
      }
    }
    walk(para)
  }
  return {
    pageCount: pages.length,
    pages,
    linebreakCount: linebreaks.length,
    paraTag: para ? para.tagName : null,
    paraTop: pRect ? Math.round(pRect.top) : null,
    paraBottom: pRect ? Math.round(pRect.bottom) : null,
    paraHeight: pRect ? Math.round(pRect.height) : null,
    rowCount: rows.length,
    rows: rows.slice(0, 4).concat(rows.slice(-4)),
  }
})

console.log('PAGE_COUNT:', data.pageCount)
console.log('PAGE_SIZES:', JSON.stringify(data.pages.map((p) => p.h)))
console.log('LINEBREAK_COUNT:', data.linebreakCount)
console.log('PARAGRAPH top:', data.paraTop, 'bottom:', data.paraBottom, 'height:', data.paraHeight)
console.log('ROW_COUNT:', data.rowCount)
console.log('ROW_SAMPLE:', JSON.stringify(data.rows))

await page.screenshot({ path: OUT })

assert(data.pageCount > 1, `段落跨页产生多张纸 (pageCount=${data.pageCount})`)
const heights = data.pages.map((p) => p.h)
const allSame = heights.every((h) => Math.abs(h - heights[0]) <= 2)
assert(allSame, `所有纸页高度一致 (${heights.join(',')})`)
assert(Math.abs(heights[0] - 1122) <= 3, `纸页高度 = 1122px 固定 (实际 ${heights[0]})`)
assert(data.linebreakCount > 0, `段落发生行级跨页拆分 (linebreak=${data.linebreakCount})`)
assert(data.paraHeight > 1122, `段落块高度跨越多页 (${data.paraHeight})`)

// 段落在首纸页内，不超出首纸页内容底（上段不越下直角）
const firstPage = data.pages[0]
if (firstPage && data.rows.length >= 2) {
  // 首纸页最后一行 bottom 应 <= 首纸页 bottom
  const firstRows = data.rows.slice(0, Math.min(4, data.rows.length))
  const maxFirstBottom = Math.max(...firstRows.map((r) => r.bottom))
  assert(maxFirstBottom <= firstPage.bottom + 2, `首页段落行不超出纸页底边 (${maxFirstBottom} <= ${firstPage.bottom})`)
}

console.log('ERRORS:', errors.slice(0, 8).join(' | ') || 'none')
await browser.close()
