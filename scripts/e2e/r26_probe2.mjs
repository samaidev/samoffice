// 有头模式也复现 —— 不是 Playwright headless bug。是真实浏览器行为。
// 下一步：从 elementFromPoint(SPAN) 的角度找事件丢失。SPAN 的 all 层中
// 「DIV. pe=none z=0」是纸页层。真正怪的是 hover=HTML。
// 尝试：直接给 SPAN 派发合成 mousedown + 检查 PM 是否响应（绕过 hit-test）
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

// A) 合成事件（isTrusted=false）dispatch 到 SPAN —— PM 应响应
const synth = await p.evaluate(() => {
  const v = window.__pmView
  const td = [...document.querySelectorAll('.ProseMirror td')][2]
  const span = td.querySelector('span, p')?.firstChild?.parentElement || td
  const r = span.getBoundingClientRect()
  const opts = { bubbles: true, cancelable: true, clientX: r.x + 5, clientY: r.y + r.height / 2, button: 0, view: window }
  span.dispatchEvent(new MouseEvent('mousedown', opts))
  span.dispatchEvent(new MouseEvent('mouseup', opts))
  span.dispatchEvent(new MouseEvent('click', opts))
  const s = v.state.selection
  return { sel: s.type?.name, from: s.from, focus: v.hasFocus() }
})
console.log('synth events → PM:', JSON.stringify(synth))
// B) 真实点击同一位置，抓取事件层到达 window 的情况（已有结论：无）
// C) 检查 editorScroll 容器 scrollTop 与 scrollIntoView 的关系 —— 表格可能
//    处于 overflow-auto 容器的「滚动区域」但容器视口已滚动 → Chromium bug:
//    compositor 用的是旧 scroll offset？试着不用 scrollIntoView，直接设 scrollTop
const scrollTest = await p.evaluate(() => {
  const sc = document.querySelector('.flex-1.overflow-auto')
  const scTop0 = sc.scrollTop
  const td = [...document.querySelectorAll('.ProseMirror td')][2]
  const tdTop = td.getBoundingClientRect().top + scTop0 - sc.getBoundingClientRect().top
  sc.scrollTop = tdTop - 300
  return { scTop0, setTo: tdTop - 300 }
})
await p.waitForTimeout(800)
await p.evaluate(() => { window.__s2 = []; window.addEventListener('pointerdown', e => window.__s2.push(e.target.tagName), true) })
const box2 = await p.evaluate(() => {
  const r = [...document.querySelectorAll('.ProseMirror td')][2].getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, vis: r.y > 0 && r.y < innerHeight }
})
console.log('after manual scrollTop, box:', JSON.stringify(box2))
await p.mouse.click(box2.x, box2.y)
await p.waitForTimeout(250)
console.log('events after manual scroll:', JSON.stringify(await p.evaluate(() => window.__s2)))
await b.close()
