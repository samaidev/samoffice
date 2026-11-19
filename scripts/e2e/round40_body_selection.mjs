// round40 复现：正文选择问题（用户反馈）
// ① 经常无法获得光标焦点 —— 网格点击正文多处，统计 caret 落点成功率
// ② 无法跨行/跨段落/中间几个字多选 —— 拖选验证
// 分别在 zoom=100 与 zoom=125（transform 缩放层挂起）下各跑一轮
import { chromium } from 'playwright'
import fs from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })

const mkDoc = () => {
  const para = (t) => ({ type: 'paragraph', inline: [{ type: 'text', content: t }] })
  const blocks = [{ type: 'heading', level: 1, inline: [{ type: 'text', content: 'round40 正文选择测试文档' }] }]
  // 8 个长段落（3+ 页），供网格点击与跨行跨段拖选
  for (let i = 1; i <= 8; i++) {
    blocks.push(para(`第${i}段落的内容文本。${'这是一段用于测试正文选择行为的较长文本，包含中文汉字与 English words 混排，用于验证光标定位与拖选跨行跨段的正确性。'.repeat(3)}`))
  }
  return { meta: { title: 'r40' }, comments: [], blocks }
}
const DOC = mkDoc()

const runRound = async (zoomVal) => {
  const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
  p.setDefaultTimeout(30000)
  const errs = []
  p.on('pageerror', e => errs.push(e.message.slice(0, 120)))
  await p.goto(`${BASE}/?r40=${zoomVal}-${Date.now()}`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(1200)
  await p.evaluate(d => window.__setDocForTest(d), DOC)
  await p.waitForTimeout(3500)
  // 设 zoom（localStorage 持久化路径 + 状态）
  // 设 zoom：localStorage 写入 → reload 后由 useState 初始化读取。
  // reload 会清掉 __setDocForTest 注入的文档 → 重注入。
  if (zoomVal !== 100) {
    await p.evaluate(z => { localStorage.setItem('samoffice_zoom', String(z)) }, zoomVal)
    await p.reload({ waitUntil: 'networkidle' })
    await p.waitForTimeout(1500)
    await p.evaluate(d => window.__setDocForTest(d), DOC)
    await p.waitForTimeout(3000)
  }
  const curZoom = await p.evaluate(() => localStorage.getItem('samoffice_zoom') || '100')

  // ---------- ① 网格点击：正文 5x5=25 个点，验证 caret 成功落下 ----------
  const clickGrid = await p.evaluate(() => {
    const pm = document.querySelector('.ProseMirror')
    const pr = pm.getBoundingClientRect()
    // 只取前 3 个段落 p 的中线附近
    const ps = [...pm.querySelectorAll('p')].slice(0, 3)
    const pts = []
    ps.forEach((el, pi) => {
      const r = el.getBoundingClientRect()
      for (let k = 0; k < 5; k++) {
        pts.push({ x: Math.round(r.left + 30 + k * (r.width - 60) / 4), y: Math.round(r.top + r.height * (pi === 0 ? 0.5 : 0.5)), paraIdx: pi })
      }
    })
    return { pts, prW: pr.width }
  })
  let caretOK = 0
  const caretFails = []
  for (const pt of clickGrid.pts) {
    await p.mouse.click(pt.x, pt.y)
    await p.waitForTimeout(60)
    const st = await p.evaluate(() => {
      const sel = window.getSelection()
      const focused = document.activeElement?.closest('.ProseMirror') != null
      return { selLen: sel ? String(sel).length : -1, anchorNode: sel?.anchorNode?.nodeName, focused }
    })
    const ok = st.focused && st.selLen === 0
    if (ok) caretOK++
    else caretFails.push({ pt, st })
  }
  console.log(`[zoom=${curZoom}] ① 网格点击: ${caretOK}/${clickGrid.pts.length} 获得 caret ${caretOK === clickGrid.pts.length ? '✓' : '✗'}`)
  if (caretFails.length) console.log('   失败样例:', JSON.stringify(caretFails.slice(0, 3)))

  // ---------- ② 拖选 ----------
  // 找一个长段落，用 Range.getClientRects() 数真实行，
  // 取第 2 行中间 → 第 4 行中间（跨行）
  const selTest = await p.evaluate(() => {
    const el = [...document.querySelector('.ProseMirror').querySelectorAll('p')][1]
    const r = el.getBoundingClientRect()
    const range = document.createRange()
    range.selectNodeContents(el)
    const rects = [...range.getClientRects()]
    // 合并同一行的 rect（按 top 聚类）
    const lineMap = new Map()
    for (const cr of rects) {
      if (!cr.height) continue
      const key = Math.round(cr.top / 6)
      const cur = lineMap.get(key)
      if (!cur) lineMap.set(key, { top: cr.top, bottom: cr.bottom })
      else { cur.top = Math.min(cur.top, cr.top); cur.bottom = Math.max(cur.bottom, cr.bottom) }
    }
    const lines = [...lineMap.values()].sort((a, b) => a.top - b.top)
    const midOf = (i) => (i < lines.length ? Math.round((lines[i].top + lines[i].bottom) / 2) : Math.round(r.bottom - 4))
    return {
      x1: Math.round(r.left + r.width * 0.45), y1: midOf(1),
      x2: Math.round(r.left + r.width * 0.55), y2: midOf(3),
      lines: lines.length,
    }
  })
  console.log("selTest:", JSON.stringify(selTest))
  const results = {}
  // 行内拖选（p[1] 第 2 行内微移 40px）
  await p.mouse.move(selTest.x1, selTest.y1)
  await p.mouse.down()
  await p.mouse.move(selTest.x1 + 40, selTest.y1, { steps: 4 })
  await p.mouse.up()
  await p.waitForTimeout(150)
  results.inLine = await p.evaluate(() => String(window.getSelection()))
  // 跨行拖选（p[2] 第 2 行 → 第 4 行；用不同段做起笔 ——
  // 同一位置连续两次 mousedown 会被 Chromium 视为对既有选区的
  // 拖动（浏览器标准行为，Word 同款），不重建选区）
  const selTest2 = await p.evaluate(() => {
    const el = [...document.querySelector('.ProseMirror').querySelectorAll('p')][2]
    const r = el.getBoundingClientRect()
    const range = document.createRange()
    range.selectNodeContents(el)
    const rects = [...range.getClientRects()]
    const lineMap = new Map()
    for (const cr of rects) {
      if (!cr.height) continue
      const key = Math.round(cr.top / 6)
      const cur = lineMap.get(key)
      if (!cur) lineMap.set(key, { top: cr.top, bottom: cr.bottom })
      else { cur.top = Math.min(cur.top, cr.top); cur.bottom = Math.max(cur.bottom, cr.bottom) }
    }
    const lines = [...lineMap.values()].sort((a, b) => a.top - b.top)
    const midOf = (i) => (i < lines.length ? Math.round((lines[i].top + lines[i].bottom) / 2) : Math.round(r.bottom - 4))
    return { x1: Math.round(r.left + r.width * 0.45), y1: midOf(1), x2: Math.round(r.left + r.width * 0.55), y2: midOf(3) }
  })
  await p.mouse.move(selTest2.x1, selTest2.y1)
  await p.mouse.down()
  await p.mouse.move(selTest2.x2, selTest2.y2, { steps: 6 })
  await p.mouse.up()
  await p.waitForTimeout(150)
  results.crossLine = await p.evaluate(() => String(window.getSelection()))
  // 跨段拖选（段 1 中部 → 段 3 中部）
  const paras = await p.evaluate(() => {
    const ps = [...document.querySelector('.ProseMirror').querySelectorAll('p')]
    const a = ps[1].getBoundingClientRect(), c = ps[3].getBoundingClientRect()
    return { x1: Math.round(a.left + 80), y1: Math.round(a.top + a.height / 2), x2: Math.round(c.left + 80), y2: Math.round(c.top + c.height / 2) }
  })
  await p.mouse.move(paras.x1, paras.y1)
  await p.mouse.down()
  for (let i = 1; i <= 8; i++) { await p.mouse.move(paras.x1 + (paras.x2 - paras.x1) * i / 8, paras.y1 + (paras.y2 - paras.y1) * i / 8); await p.waitForTimeout(30) }
  await p.mouse.up()
  await p.waitForTimeout(200)
  results.crossPara = await p.evaluate(() => String(window.getSelection()))
  // 中间几个字（双击词 + shift 点击 / 或拖选 3 个字符）
  const mid = await p.evaluate(() => {
    const ps = [...document.querySelector('.ProseMirror').querySelectorAll('p')]
    const r = ps[4].getBoundingClientRect()
    return { x1: Math.round(r.left + r.width * 0.3), y: Math.round(r.top + r.height / 2) }
  })
  await p.mouse.move(mid.x1, mid.y)
  await p.mouse.down()
  await p.mouse.move(mid.x1 + 50, mid.y, { steps: 3 })
  await p.mouse.up()
  await p.waitForTimeout(150)
  results.midWords = await p.evaluate(() => String(window.getSelection()))
  // 双击选词
  await p.mouse.dblclick(mid.x1, mid.y)
  await p.waitForTimeout(200)
  results.dblClick = await p.evaluate(() => String(window.getSelection()))

  const judge = (s, min) => s && s.replace(/\n/g, '').length >= min
  console.log(`   ② 行内拖选: "${results.inLine.slice(0, 18)}"(${results.inLine.replace(/\n/g, '').length}字) ${judge(results.inLine, 2) ? '✓' : '✗'}`)
  console.log(`   ② 跨行拖选: "${results.crossLine.slice(0, 18)}"(${results.crossLine.replace(/\n/g, '').length}字) ${judge(results.crossLine, 20) ? '✓' : '✗'}`)
  console.log(`   ② 跨段拖选: "${results.crossPara.slice(0, 18)}"...(${results.crossPara.replace(/\n/g, '').length}字) ${judge(results.crossPara, 100) ? '✓' : '✗'}`)
  console.log(`   ② 中间数字: "${results.midWords.slice(0, 18)}"(${results.midWords.replace(/\n/g, '').length}字) ${judge(results.midWords, 2) ? '✓' : '✗'}`)
  console.log(`   ② 双击选词: "${results.dblClick.slice(0, 12)}"(${results.dblClick.replace(/\n/g, '').length}字) ${results.dblClick.length >= 2 ? '✓' : '✗'}`)
  console.log(`   pageerror: ${errs.length}`)
  await p.close()
  return {
    zoom: curZoom, caretOK, caretTotal: clickGrid.pts.length,
    inLine: judge(results.inLine, 2), crossLine: judge(results.crossLine, 20),
    crossPara: judge(results.crossPara, 100), midWords: judge(results.midWords, 2),
    dbl: results.dblClick.length >= 2, errs: errs.length,
  }
}

const r100 = await runRound(100)
const r125 = await runRound(125)
console.log('\n=== 汇总 ===')
for (const r of [r100, r125]) {
  console.log(`zoom=${r.zoom}: caret ${r.caretOK}/${r.caretTotal} | 行内${r.inLine ? '✓' : '✗'} 跨行${r.crossLine ? '✓' : '✗'} 跨段${r.crossPara ? '✓' : '✗'} 中间字${r.midWords ? '✓' : '✗'} 双击${r.dbl ? '✓' : '✗'} err${r.errs}`)
}
await b.close()
const allPass = [r100, r125].every(r => r.caretOK === r.caretTotal && r.inLine && r.crossLine && r.crossPara && r.midWords && r.dbl && r.errs === 0)
console.log(`=== round40 结果: ${allPass ? 'ALL PASS ✓' : 'FAIL ✗'} ===`)
process.exit(0) // 复现阶段不判失败退出
