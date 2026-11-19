// round40 诊断：拖选事件链（mousedown target / preventDefault / selection 结果）
import { chromium } from 'playwright'

const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
const errs = []
p.on('pageerror', e => errs.push(e.message.slice(0, 120)))
await p.goto('http://localhost:18400/?sel=' + Date.now(), { waitUntil: 'networkidle', timeout: 30000 })
await p.waitForTimeout(1200)
const DOC = {
  meta: {}, comments: [],
  blocks: [
    { type: 'paragraph', inline: [{ type: 'text', content: `第一段测试文本。${'这是用于测试拖选的正文内容，验证能否跨行选择文字。'.repeat(4)}` }] },
    { type: 'paragraph', inline: [{ type: 'text', content: `第二段测试文本。${'第二段的正文内容，用于跨段选择验证。'.repeat(4)}` }] },
  ],
}
await p.evaluate(d => window.__setDocForTest(d), DOC)
await p.waitForTimeout(3000)
// 仪器化
await p.evaluate(() => {
  window.__evlog = []
  const log = (type, e) => {
    window.__evlog.push({
      type, x: e.clientX, y: e.clientY, def: e.defaultPrevented, btn: e.buttons,
      tgt: (e.target.tagName || '?') + (e.target.className && typeof e.target.className === 'string' ? '.' + e.target.className.split(' ')[0] : ''),
      el: (() => { const el = document.elementFromPoint(e.clientX, e.clientY); return el ? (el.tagName + (typeof el.className === 'string' && el.className ? '.' + el.className.split(' ')[0] : '')) : 'null' })(),
    })
  }
  for (const t of ['mousedown', 'mouseup']) document.addEventListener(t, e => log(t, e), { capture: true, passive: true })
  let moves = 0
  document.addEventListener('mousemove', e => { if (e.buttons & 1 && moves < 3) { moves++; log('move', e) } }, { capture: true, passive: true })
})
const box = await p.evaluate(() => {
  const ps = [...document.querySelector('.ProseMirror').querySelectorAll('p')]
  const r = ps[0].getBoundingClientRect()
  return { x1: Math.round(r.left + 100), y1: Math.round(r.top + r.height / 2), x2: Math.round(r.left + 200), y2: Math.round(r.top + r.height / 2 + 40) }
})
await p.mouse.move(box.x1, box.y1)
await p.mouse.down()
await p.mouse.move(box.x2, box.y2, { steps: 5 })
await p.mouse.up()
await p.waitForTimeout(250)
const out = await p.evaluate(() => ({
  log: window.__evlog,
  sel: String(window.getSelection()),
  anchorIn: window.getSelection().anchorNode?.parentElement?.closest('.ProseMirror') != null,
}))
console.log('事件日志:')
for (const l of out.log) console.log(' ', JSON.stringify(l))
console.log('选区:', JSON.stringify(out.sel.slice(0, 40)), 'anchorInPM:', out.anchorIn)
console.log('pageerror:', errs.length, errs.slice(0, 2))
await b.close()
