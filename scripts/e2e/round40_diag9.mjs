// round40 诊断9：多页文档 p[1] 拖选 0 字 —— mousedown 链与 DOM selection 变化
import { chromium } from 'playwright'

const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
const errs = []
p.on('pageerror', e => errs.push(e.message.slice(0, 150)))
await p.goto('http://localhost:18400/?sel9=' + Date.now(), { waitUntil: 'networkidle', timeout: 30000 })
await p.waitForTimeout(1200)
const DOC = {
  meta: { title: 'r40' }, comments: [],
  blocks: [
    { type: 'heading', level: 1, inline: [{ type: 'text', content: 'round40 正文选择测试文档' }] },
    ...Array.from({ length: 8 }, (_, i) => ({
      type: 'paragraph',
      inline: [{ type: 'text', content: `第${i + 1}段落的内容文本。${'这是一段用于测试正文选择行为的较长文本，包含中文汉字与 English words 混排，用于验证光标定位与拖选跨行跨段的正确性。'.repeat(3)}` }],
    })),
  ],
}
await p.evaluate(d => window.__setDocForTest(d), DOC)
await p.waitForTimeout(3500)

// p[1] 的几何与装饰状态
const info = await p.evaluate(() => {
  const el = [...document.querySelector('.ProseMirror').querySelectorAll('p')][1]
  const r = el.getBoundingClientRect()
  const cls = el.className
  const prev = el.previousElementSibling
  // 找 p[1] 内所有行（用 range 测行边界不可行，改用 caretRangeFromPoint 探测）
  const lineYs = []
  for (let y = Math.round(r.top); y < r.bottom; y += 4) {
    const cr = document.caretRangeFromPoint(Math.round(r.left + 20), y)
    if (cr) lineYs.push({ y, textOff: cr.startOffset, node: cr.startContainer.nodeName })
  }
  // 分页装饰元素
  const decos = [...document.querySelectorAll('.pg-linebreak, .pg-brk')].map(e2 => ({
    cls: e2.className, mt: e2.style.marginTop || e2.getAttribute('style') || '', inP1: false,
  }))
  return { rect: { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) }, cls, prevCls: prev?.className, lineYs: lineYs.filter((v, i, a) => i === 0 || v.textOff !== a[i - 1].textOff), decoCount: decos.length }
})
console.log('p[1] 信息:', JSON.stringify(info, null, 1))

// instrument selectionchange
await p.evaluate(() => {
  window.__selChanges = []
  document.addEventListener('selectionchange', () => {
    const s = window.getSelection()
    window.__selChanges.push({ t: Date.now() % 100000, collapsed: s.isCollapsed, len: String(s).length, anchorOff: s.anchorOffset, focusOff: s.focusOffset })
  })
  window.__evs = []
  for (const t of ['mousedown', 'mouseup']) document.addEventListener(t, e => window.__evs.push({ t, tgt: e.target.tagName + '.' + (typeof e.target.className === 'string' ? e.target.className.split(' ')[0] : ''), x: e.clientX, y: e.clientY }), { capture: true, passive: true })
})

const c = await p.evaluate(() => {
  const el = [...document.querySelector('.ProseMirror').querySelectorAll('p')][1]
  const r = el.getBoundingClientRect()
  const rh = r.height / 5
  return { x1: Math.round(r.left + r.width * 0.45), y1: Math.round(r.top + rh * 1.5), x2: Math.round(r.left + r.width * 0.55), y2: Math.round(r.top + rh * 3.5) }
})
console.log('拖选坐标:', JSON.stringify(c))
await p.mouse.move(c.x1, c.y1)
await p.mouse.down()
await p.mouse.move(c.x2, c.y2, { steps: 6 })
await p.mouse.up()
await p.waitForTimeout(300)
const out = await p.evaluate(() => ({
  evs: window.__evs, selChanges: window.__selChanges.slice(-8), final: String(window.getSelection()).length,
  focusIn: document.activeElement?.closest('.ProseMirror') != null,
}))
console.log('事件:', JSON.stringify(out.evs))
console.log('selectionchange:', JSON.stringify(out.selChanges))
console.log('最终选区:', out.final, '字 focusIn:', out.focusIn)

// 对照：p[2]（不同段落）同样拖法
const c2 = await p.evaluate(() => {
  const el = [...document.querySelector('.ProseMirror').querySelectorAll('p')][2]
  const r = el.getBoundingClientRect()
  const rh = r.height / 5
  return { x1: Math.round(r.left + r.width * 0.45), y1: Math.round(r.top + rh * 1.5), x2: Math.round(r.left + r.width * 0.55), y2: Math.round(r.top + rh * 3.5) }
})
await p.mouse.move(c2.x1, c2.y1)
await p.mouse.down()
await p.mouse.move(c2.x2, c2.y2, { steps: 6 })
await p.mouse.up()
await p.waitForTimeout(300)
console.log('p[2] 拖选:', await p.evaluate(() => String(window.getSelection()).replace(/\n/g, '').length), '字')
console.log('pageerror:', errs.length)
await b.close()
