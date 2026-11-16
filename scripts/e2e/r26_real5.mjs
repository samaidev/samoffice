// tbody 替换死（PM contentDOM 引用旧 tbody —— PM 又修回或内容丢失）。
// 机理清晰但所有「PM 内」方案都被 DOMObserver 抵消。
// ◆◆◆ 终极务实方案：**pointer 事件兜底**。死区只是「鼠标事件不派发」，
// 但 pointermove 正常吗？—— 之前 window.__pd 记录显示 pointerdown 都没有。
// 但【mousemove 在 wrapper 外正常】。在 wrapper 上直接挂 mousedown 监听 ——
// 事件若不派发，元素级监听也没用。
// ◆ 检查最后一种可能：**事件其实派发了但到不了任何 JS —— 派发到了
// 【ShadowRoot / Web Component】？** 无 shadow（查过 0）。
// ◆◆◆◆ 大杀器验证：**Chromium 的 Event.path**。用 CDP 
// Runtime.evaluate 挂 Object.defineProperty 到 Event.prototype —— 
// 已经太晚了。事件没派发就是没派发。
// ◆★★ 转向「绕开 hit-test」的终极方案：**CSS zoom != 1**！
// 之前 zoom audit 都是 1。但 Chromium 对 zoom 属性的处理走【主线程
// hit-test】（老代码路径）—— 验证：给 .ProseMirror 或 pageRef 加 
// zoom:0.999（视觉几乎无差）→ 死区是否消失！
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
await p.evaluate(() => window.__setDocForTest({ meta: { title: 't' }, blocks: [
  { type: 'p', inline: [{ content: '段落内容' }] },
  { type: 'table', rows: [
    [{ inline: [{ content: 'A1' }] }, { inline: [{ content: 'B1' }] }],
    [{ inline: [{ content: 'A2' }] }, { inline: [{ content: 'B2' }] }],
  ] },
] }))
await p.waitForTimeout(3000)
const test = async (name, css) => {
  await p.evaluate((c) => {
    const st = document.getElementById('tp') || (() => { const s = document.createElement('style'); s.id = 'tp'; document.head.appendChild(s); return s })()
    st.textContent = c
  }, css)
  await p.waitForTimeout(350)
  await p.evaluate(() => { window.__ev = 0; window.addEventListener('pointerdown', () => window.__ev++, { capture: true, passive: true }) })
  const box = await p.evaluate(() => { const r = document.querySelector('.ProseMirror td').getBoundingClientRect(); return { x: r.x + r.width * 0.7, y: r.y + r.height * 0.5 } })
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(250)
  console.log(`${name}:`, (await p.evaluate(() => window.__ev)) > 0 ? 'ALIVE ✅' : 'DEAD')
}
await test('baseline', '')
await test('zoom 0.999 on .ProseMirror', '.ProseMirror { zoom: 0.999 }')
await test('zoom 1.001 on .ProseMirror', '.ProseMirror { zoom: 1.001 }')
await test('zoom 0.999 on wrapper', '.ProseMirror .tableWrapper { zoom: 0.999 }')
await test('zoom 0.999 on table', '.ProseMirror .tableWrapper table { zoom: 0.999 }')
await b.close()
