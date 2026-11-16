// pm-host 里的 fixed 表格也死！但 body 里的 fixed 表格活（probe17）！
// pm-host 与 body 的差异：pm-host 在 editorScroll(overflow-auto, scrollTop 9441)
// 内部 + 缩放层 + pageRef。fixed 在有 transformed ancestor 时相对该祖先。
// pm-host 无 transform —— fixed 应该相对 viewport。
// ★★★ 但 scrollTop=9441！**position:fixed 元素在有滚动祖先（无 transform）时
// 仍相对 viewport —— 除非……好吧，直接验证「视口区」假设：
// 同样的 fixed 表格放【body】但坐标取 TD 位置（已经做过=ALIVE）。
// 放【pm-host】= DEAD。pm-host 的什么在挡？pm-host 自身？把表格放
// pageRef / scaler / editorScroll 逐个试（fixed 全保留）：
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
const hosts = ['pm-host', 'scaler', 'pageRef', 'editorScroll', 'd9-root', 'main', 'body']
const results = []
for (const h of hosts) {
  const box = await p.evaluate((h) => {
    // 移除上一个测试表
    document.querySelectorAll('[data-tprobe]').forEach(e => e.remove())
    const td = [...document.querySelectorAll('.ProseMirror td')][2]
    const r = td.getBoundingClientRect()
    let host
    if (h === 'body') host = document.body
    else if (h === 'pm-host') host = window.__pmView.dom.parentElement
    else if (h === 'scaler') host = window.__pmView.dom.parentElement.parentElement
    else if (h === 'pageRef') host = window.__pmView.dom.closest('.mx-auto')
    else if (h === 'editorScroll') host = document.querySelector('.flex-1.overflow-auto')
    else if (h === 'd9-root') host = document.querySelector('.flex.flex-col.h-full')
    else if (h === 'main') host = document.querySelector('main')
    if (!host) return null
    const t = document.createElement('table')
    t.setAttribute('data-tprobe', '1')
    t.style.cssText = `position:fixed;left:${r.x}px;top:${r.y}px;width:${r.width}px;height:${r.height}px;z-index:2147483647;background:#fffde7;pointer-events:auto`
    t.innerHTML = '<tr><td>P</td></tr>'
    host.appendChild(t)
    window.__e = []
    window.addEventListener('pointerdown', e => window.__e.push(e.target.tagName), { capture: true, passive: true })
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  }, h)
  if (!box) { results.push(`${h}: no-host`); continue }
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(150)
  const ev = await p.evaluate(() => window.__e)
  results.push(`${h}: ${ev.length ? 'ALIVE(' + ev[0] + ')' : 'DEAD'}`)
}
console.log(results.join('\n'))
await b.close()
