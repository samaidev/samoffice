// .ProseMirror 基础规则无异常。但去掉 class 就活 —— 二分 CSS 规则！
// 方法：逐条禁用 .ProseMirror 的关键声明（white-space/overflow-wrap/min-height…）
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1000)
const buf = fs.readFileSync(DOC)
const form = new FormData()
form.append('file', new Blob([buf]), 'contract.docx')
const r = await fetch(BASE + '/api/doc/open', { method: 'POST', body: form })
const j = await r.json()
await p.evaluate(d => window.__setDocForTest(d), j.document)
await p.waitForTimeout(4000)
await p.evaluate(() => { [...document.querySelectorAll('.ProseMirror td')][2].scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(1000)
const test = async (name, cssOverride) => {
  const box = await p.evaluate((css) => {
    const pm = window.__pmView.dom
    const td = [...document.querySelectorAll('.ProseMirror td')][2]
    const wrapper = td.closest('.tableWrapper')
    document.querySelectorAll('[data-tprobe]').forEach(e => e.remove())
    const t = document.createElement('table')
    t.setAttribute('data-tprobe', '1')
    t.style.cssText = 'border:2px solid #d33;width:300px;height:70px;background:#fffde7;position:relative;z-index:9'
    t.innerHTML = '<tr><td>V</td></tr>'
    wrapper.parentElement.insertBefore(t, wrapper)
    // 应用覆盖
    const st = document.getElementById('tprobe-style') || document.createElement('style')
    st.id = 'tprobe-style'
    st.textContent = css
    document.head.appendChild(st)
    window.__e = []
    window.addEventListener('pointerdown', e => window.__e.push(e.target.tagName), { capture: true, passive: true })
    const r = t.getBoundingClientRect()
    return { x: r.x + 40, y: r.y + 35 }
  }, cssOverride)
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(150)
  const alive = (await p.evaluate(() => window.__e.length)) > 0
  console.log(`${name}: ${alive ? 'ALIVE ✅' : 'DEAD'}`)
}
await test('baseline', '')
await test('white-space normal', '.ProseMirror { white-space: normal !important }')
await test('overflow-wrap normal', '.ProseMirror { overflow-wrap: normal !important; word-wrap: normal !important }')
await test('min-height auto', '.ProseMirror { min-height: auto !important }')
await test('全部重置', '.ProseMirror { all: unset !important; display: block; min-height: 500px }')
await b.close()
