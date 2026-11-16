// 只有一份表格。hitChain 干净。合成器却不认。
// 潜在黑洞：pm-host 上层有一个「pg-paper 容器」（sheetsLayer position:absolute inset:0
// pointerEvents:none zIndex:0），其父级缩放层 transform:scale(1)。
// 但段落点击正常，表格不行 —— 两者都在同一层！
// 区别只剩一个：**表格 wrapper 或 PM dom 有 column-span / break-inside 或
// contain 属性**。查 index.css 的 .pm-table / tableWrapper 相关规则！
// 直接在浏览器里打印 TD 与 P 的全部有效样式差异（对比合成器敏感属性）：
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(800)
const buf = fs.readFileSync(DOC)
const form = new FormData()
form.append('file', new Blob([buf]), 'contract.docx')
const r = await fetch(BASE + '/api/doc/open', { method: 'POST', body: form })
const j = await r.json()
await p.evaluate(d => window.__setDocForTest(d), j.document)
await p.waitForTimeout(3500)
await p.evaluate(() => { [...document.querySelectorAll('.ProseMirror td')][2].scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(1200)
const cmp = await p.evaluate(() => {
  const td = [...document.querySelectorAll('.ProseMirror td')][2]
  const pEl = [...document.querySelectorAll('.ProseMirror p')].find(pp => { const rr = pp.getBoundingClientRect(); return rr.y > 80 && rr.y < innerHeight - 80 && rr.height > 8 })
  const pick = (el) => {
    const s = getComputedStyle(el)
    return {
      transform: s.transform, willChange: s.willChange, contain: s.contain,
      backfaceVisibility: s.backfaceVisibility, isolation: s.isolation,
      breakInside: s.breakInside, columnSpan: s.columnSpan, contentVisibility: s.contentVisibility,
      touchAction: s.touchAction, pointerEvents: s.pointerEvents, position: s.position,
      zIndex: s.zIndex, filter: s.filter, opacity: s.opacity, mixBlendMode: s.mixBlendMode,
      clipPath: s.clipPath, mask: (s.maskImage || 'none').toString().slice(0, 30),
      translate: s.translate, rotate: s.rotate, scale: s.scale, offsetRotate: s.offsetRotation,
    }
  }
  // 对比每层祖先
  const chainOf = (el) => { const a = []; let e = el; while (e && e !== document.body) { a.push({ d: e.tagName + '.' + (e.className || '').toString().slice(0, 18), s: pick(e) }); e = e.parentElement } return a }
  const tdChain = chainOf(td)
  const pChain = chainOf(pEl)
  const diffs = []
  const n = Math.min(tdChain.length, pChain.length)
  for (let i = 0; i < n; i++) {
    const a = tdChain[i], bq = pChain[pChain.length - n + i]
    if (a.d !== bq.d) { diffs.push(`level-${i}: TD-chain=${a.d} vs P-chain=${bq.d}`); continue }
    for (const k of Object.keys(a.s)) {
      if (String(a.s[k]) !== String(bq.s[k])) diffs.push(`${a.d} ${k}: td=${a.s[k]} p=${bq.s[k]}`)
    }
  }
  return { diffs: diffs.slice(0, 30), tdDepth: tdChain.length, pDepth: pChain.length }
})
console.log(JSON.stringify(cmp, null, 1))
await b.close()
