// 行无 transform、无断页。表格第一行 y=516，屏幕 900 高 —— 完全在视口内。
// 但整个表格区（516~1003）无事件，段落区有。
// 再看一个数字：papers[0] top=-9202！纸张层不在视口 —— 但这是**视口坐标系**
// 里第一张纸。表格在 516~1003，纸张 top=-9202 bottom=-8079？？纸张跟内容
// 完全脱节！这说明视口里看到的"白纸"根本不是 .pg-paper（是第一页 y=54~1177
// 那张 —— 来自更早 probe）。等等 —— pg-paper 有 2 组！
// （probe9: pe=none rect=-9202~7640；probe12: papers[0] top=-9202 bottom=-8079）
// 但 probe 早前发现 pg-paper rect=54~1177 —— 两个不同的 pg-paper？
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
await p.waitForTimeout(1500)
const q = await p.evaluate(() => {
  const papers = [...document.querySelectorAll('.pg-paper')]
  const near = papers.map((pp, i) => { const r = pp.getBoundingClientRect(); return { i, top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), pe: getComputedStyle(pp.parentElement).pointerEvents } }).filter(x => x.bottom > 0 && x.top < 900)
  // 找所有"覆盖 TD 的非 pe=none 元素"再一次（精确含所有，不管 static）
  const td = [...document.querySelectorAll('.ProseMirror td')][2]
  const r = td.getBoundingClientRect()
  const x = r.x + r.width / 2, y = r.y + r.height / 2
  const stack = document.elementsFromPoint(x, y)
  // 关键新检查：stack 中 SPAN 的 offsetParent 是谁？如果 SPAN 的
  // offsetParent 不是 tableWrapper（例如被跳到更外层），说明 TD 有"层"问题
  const span = stack[0]
  return { nearPapers: near, stackHead: stack.slice(0, 4).map(e => e.tagName + '.' + (e.className || '').toString().slice(0, 15)), spanOffsetParent: span?.offsetParent?.tagName + '.' + (span?.offsetParent?.className || '').toString().slice(0, 20) }
})
console.log(JSON.stringify(q, null, 1))
await b.close()
