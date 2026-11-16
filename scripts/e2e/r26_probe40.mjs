// ★ 流内克隆（PM 末尾）也死！而 about:blank 同样 DOM 活。
// PM dom 内追加的 DOM 依然受 PM 的 ViewDesc 树管理冲突？—— 但事件是
// 浏览器层的，PM 不管。除非…… **PM 的 DOMObserver 在每帧把"未注册 DOM"
// 修剪掉/重写**！观察：300ms 后克隆还在吗？属性变了吗？
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
const st = await p.evaluate(() => {
  const pm = window.__pmView.dom
  const wraps = [...document.querySelectorAll('.tableWrapper')]
  const clone = wraps[0].cloneNode(true)
  clone.setAttribute('data-clone', 'r26')
  pm.appendChild(clone)
  return { appended: true }
})
await p.waitForTimeout(800)
const check = await p.evaluate(() => {
  const clones = document.querySelectorAll('[data-clone=r26]')
  const pm = window.__pmView.dom
  return {
    stillThere: clones.length > 0,
    inPM: clones.length > 0 && pm.contains(clones[0]),
    rectBottom: Math.round(pm.getBoundingClientRect().bottom),
    pmScrollH: pm.scrollHeight,
  }
})
console.log('clone persistence:', JSON.stringify(check))
// PM 视图描述符警告？监听 console 1 秒
await b.close()
