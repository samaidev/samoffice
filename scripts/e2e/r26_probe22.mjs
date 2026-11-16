// ★★★ 突破口！克隆表 fixed z=99999 放在 PM dom 内 → 点击 target=HTML（事件
// 到了 window 但 target 是 HTML —— 即点击"落空"了）。而同样的克隆放 body → TD。
// fixed 元素在 PM dom 内时点击落空 → PM dom 或其祖先建立了 containing block /
// 或有 CSS 让 fixed 失效（transform/filter/perspective on ancestor）！
// transform 祖先会把 fixed 变成相对该层 —— 缩放层有 transform:scale(1)！
// scale(1) 恒等但仍是 transform！而 body 直下无 transform 祖先 → fixed 正常。
// 结论呼之欲出：**编辑器缩放层的 transform 让整棵子树的合成器 hit-test
// 与主线程错位**（某种 Chromium bug 或矩阵精度问题）。但段落能点……
// 段落在同一层 —— 矛盾。除非错位量只有几十像素且恰好只影响表格区
// （表格在 PM dom 的【后半段】，越往下错位越大）！
// 验证：在 PM dom 底部放个 fixed 探针（正文最后），点击 —— 若错位，
// 点击探针视觉位置会命中它上方 N px 的元素。
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
// 探针：在 PM dom 内放 60x60 红块（不 fixed，static 流内），观察点击命中偏差
const probe = await p.evaluate(() => {
  const pm = window.__pmView.dom
  const td = [...document.querySelectorAll('.ProseMirror td')][2]
  const wrapper = td.closest('.tableWrapper')
  const d = document.createElement('div')
  d.textContent = 'PROBE'
  d.style.cssText = 'height:60px;background:#f87171;color:#000;font-size:20px;z-index:999;position:relative'
  wrapper.parentElement.insertBefore(d, wrapper.nextSibling)
  const r = d.getBoundingClientRect()
  window.__p = []
  window.addEventListener('pointerdown', e => window.__p.push({ tag: e.target.tagName, x: Math.round(e.clientX), y: Math.round(e.clientY) }), true)
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
await p.mouse.click(probe.x, probe.y)
await p.waitForTimeout(200)
const hit = await p.evaluate(() => window.__p)
console.log('PROBE(表格后) click:', JSON.stringify(hit))
// 若无事件 → 点击落空区域继续延伸；若有事件但 target≠PROBE → 找到错位证据
// 再往上找边界：表格上方 20px 处（最后一个段落）点击
const above = await p.evaluate(() => {
  const td = [...document.querySelectorAll('.ProseMirror td')][2]
  const w = td.closest('.tableWrapper')
  const r = w.getBoundingClientRect()
  return { x: r.x + 100, y: r.y - 15 }
})
await p.mouse.click(above.x, above.y)
await p.waitForTimeout(200)
console.log('above-table click:', JSON.stringify(await p.evaluate(() => window.__p)))
await b.close()
