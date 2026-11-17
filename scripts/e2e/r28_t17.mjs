// EditorView.scrollToSelection ← updateStateInner —— PM 在 selection
// 变化时自动滚。但单点不跳、连续点击跳 —— 连续场景里 dispatch 的
// selection 是什么？applySel 的 60ms 补刀第二次 dispatch —— 若 PM 的
// domObserver 在 mouseup 后已把 DOM selection（被浏览器 caret 放到
// 末尾 —— r27 的 anchor=P 现象）同步进 state → 我们补刀 dispatch
// → PM scrollToSelection(格) —— 应该滚向格……却滚到 16142。
// ★★★ 真正的疑问：scrollToSelection 滚到 16142 = PM 认为光标在那。
// PM state.from=5174 —— posToDOM(5174) 应在 10108。除非分页装饰让
// posToDOM 返回【另一个位置的同 pos 节点】—— PM 的 docView 映射
// 按文档顺序 —— 唯一。◆ 检查 dispatch 时刻的 PM selection 与
// scrollToSelection 内部 target：直接看补刀 dispatch 前后的 PM state：
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 150)))
p.setDefaultTimeout(30000)
await p.goto(BASE + '/?r=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
const buf = fs.readFileSync(DOC)
const form = new FormData()
form.append('file', new Blob([buf]), 'contract.docx')
const r = await fetch(BASE + '/api/doc/open', { method: 'POST', body: form })
const j = await r.json()
await p.evaluate(d => window.__setDocForTest(d), j.document)
await p.waitForTimeout(5000)
await p.evaluate(() => { document.querySelector('.ProseMirror table').scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(1500)
// 劫持 dispatchTransaction 看 td[8] 点击后的每个事务
await p.evaluate(() => {
  window.__trs = []
  const v = window.__pmView
  const orig = v.dispatch.bind(v)
  v.dispatch = (tr) => {
    window.__trs.push({ sel: tr.selection?.from, scroll: !!tr.scrolledIntoView, meta: Object.keys(tr.meta || {}).slice(0, 3) })
    return orig(tr)
  }
})
let box = await p.evaluate(() => { const tds = [...document.querySelectorAll('td')]; const r = tds[6].getBoundingClientRect(); return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.5 } })
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(800)
await p.evaluate(() => { window.__trs = [] })
box = await p.evaluate(() => { const tds = [...document.querySelectorAll('td')]; const r = tds[8].getBoundingClientRect(); return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.5 } })
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(800)
const trs = await p.evaluate(() => [...window.__trs])
console.log('td[8] 点击的事务序列:')
trs.forEach((t, i) => console.log(` [${i}]`, JSON.stringify(t)))
console.log('最终 scroll:', await p.evaluate(() => document.querySelector('.overflow-auto').scrollTop))
await b.close()
