// scrollTop=9441！scrollHeight=17393。编辑器实际内容 16842+padding。
// TD 在 PM doc 里的位置：PM dom rect -9106~7532 → TD y=516 视口坐标
// → 文档流位置 = 516 + 9106 = 9622（相对 PM dom 顶）。
// 关键洞察：**表格跨页了！** PM dom 高 16638，分页引擎给表格区间做了
// pg-brk-table 断页处理。TD(9622) vs 页界(9441+scrollTop=内容位置)。
// 「点击落点」可能在合成器视角被「表格分页副本」占据 —— 检查 DOM 里是否
// 有两份表格（分页引擎克隆）！
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
const dup = await p.evaluate(() => {
  const tables = [...document.querySelectorAll('.ProseMirror table')]
  return {
    tableCount: tables.length,
    wrappers: [...document.querySelectorAll('.ProseMirror .tableWrapper')].length,
    // 点击点命中链里有没有第二个表格？
    hitChain: (() => {
      const r = [...document.querySelectorAll('.ProseMirror td')][2].getBoundingClientRect()
      return document.elementsFromPoint(r.x + r.width / 2, r.y + r.height / 2).map(e => e.tagName + '.' + (e.className || '').toString().slice(0, 20)).slice(0, 8)
    })(),
    // 有没有 position:absolute 的表格克隆（分页引擎或 NodeView 生成）
    absTables: tables.filter(t => getComputedStyle(t.closest('.tableWrapper') || t).position === 'absolute').length,
    // pm-host 的子元素里 .ProseMirror 的位置
  }
})
console.log(JSON.stringify(dup, null, 1))
// 检查 pg-brk-table 装饰：wrapper 是否有 margin-bottom 巨大值
const brk = await p.evaluate(() => {
  const ws = [...document.querySelectorAll('.ProseMirror .tableWrapper')]
  return ws.map((w, i) => {
    const s = getComputedStyle(w)
    return { i, mb: s.marginBottom, h: Math.round(w.getBoundingClientRect().height), cls: (w.className || '').toString().slice(0, 40) }
  })
})
console.log('wrappers:', JSON.stringify(brk))
await b.close()
