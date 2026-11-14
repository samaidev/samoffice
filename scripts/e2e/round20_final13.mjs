// ★★★ 铁律浮现：tdY=179 ✓，tdY=218 ✗！死区边界 ≈ 视口 y 200！
// 而 scroller 顶 = 215/255？—— st=300 滚动后 scroller 顶应该还是 ~255。
// 边界 179/218 之间 —— 对照 wheel4 数据（全屏扫描 235..795 全 ✓ x=500
// 正文区）—— 但那些点在正文上，不在表格上！
// 
// 合并所有证据的最终真相：
// 【表格矩形本身】是死区（wheel5：x 300-800 表格内全 ✗，表外 ✓）
// 【表格在视口上部 <~200 时可点】（final12: tdY=179 ✓ 218 ✗）
// 【无上方内容 + scrollTop=300 也 ✓】（final9）
//   —— 但 scrollTop=300 时表格被滚上去（tdY<0→ Playwright 自动滚回→坐标在上方）
// 
// ◆ 真正统一的解释：表格的【分页纸页 pg-paper 层】！纸页 pe=none，
// 但纸页位于 sheetsLayer（absolute inset 0, zIndex 0）——它覆盖【整个文档高度】。
// PM 编辑层 zIndex 1 在其上。点击表格时 Chromium compositor 事件派发
// 顺序：若 hit-test 缓存把 pm 层(高 16842px>纹理上限)截断，事件落到
// 纸页层(pe=none→穿)→ 或直接丢弃。
// 检查 sheetsLayer 的 zIndex 与 PM 层的 zIndex 竞争 —— 以及【真实 z 顺序】：
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const b = await chromium.launch({ args: ['--no-sandbox'], headless: false })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(20000)
await p.goto('http://localhost:18400', { waitUntil: 'networkidle' })
await p.evaluate(() => localStorage.setItem('samoffice_theme', 'light'))
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
const buf = fs.readFileSync(DOC)
const form = new FormData()
form.append('file', new Blob([buf]), 'contract.docx')
const r = await fetch('http://localhost:18400/api/doc/open', { method: 'POST', body: form })
const j = await r.json()
await p.evaluate(d => window.__setDocForTest(d), j.document)
await p.waitForTimeout(2500)
const info = await p.evaluate(() => {
  // pm-host（PM 所在层）与 sheetsLayer（纸页层）的层叠关系
  const pm = document.querySelector('.ProseMirror')
  const layers = []
  let n = pm
  while (n && n !== document.body) {
    const s = getComputedStyle(n)
    layers.unshift(`${n.tagName}.${(n.className?.toString().slice(0, 20) || '')} z=${s.zIndex} pos=${s.position}`)
    n = n.parentElement
  }
  // sheetsLayer
  const sl = document.querySelector('[style*="z-index: 0"]')
  const slS = sl ? getComputedStyle(sl) : null
  const slR = sl?.getBoundingClientRect()
  return {
    pmChain: layers.slice(-6),
    sheetsLayer: sl ? { z: slS.zIndex, pe: slS.pointerEvents, y: Math.round(slR.y), h: Math.round(slR.height) } : null,
  }
})
console.log(JSON.stringify(info, null, 1))
await b.close()
