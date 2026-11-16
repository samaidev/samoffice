// 渲染管线全灭 —— 不是 GPU/合成模式问题。
// ★★★★ 视角切换：也许从一开始就搞错了 —— 死的也许不是「hit-test」而是
// 【Playwright 的 mouse 坐标在整页缩放/zoom 下的换算】。之前 visualViewport=1。
// 但 —— 用户的原始报告说"点击无光标"来自真实 WebView2！说明用户环境也死。
// 用户是主要事实来源。Playwright 只是复现工具。
// ◆ 那么回到「为什么移出 PM 活」的坚实事实 —— 它不依赖 Playwright 特性。
// ◆★★★ 突破口重温：factor31 说「第二个真实编辑器窗口 DEAD, cell=空」—— 
// cell 空说明那次 setDocForTest 没生效（同 path 复用 + doc 未变?）。而
// factor32 里「编辑器1:」也是空 —— 但 factor33 里 4 个 td 内容为空、
// pmDocHasTable=[unsupported block]！说明【p 块的 type:'p' 不被识别】
// —— 但那是修正前的旧格式。现在修正后内容正常。总结没有矛盾。
// ◆◆◆◆◆ 终极工程兜底（确定有效，因为形态①wrapper 在 body 活）：
// **把 .ProseMirror 的「表格处理」改为：wrapper 挂在编辑器 dom 之外的同级
// overlay 容器，通过 CSS absolute 精确定位** —— 复杂但有效。
// 但在此之前 —— 有个 10 秒就能测的形态没测过：
// ★ wrapper 移出 PM 但保持在【pm-host】内（editorRef div，React 容器，
// PM 之外！）：若活 → 官方 NodeView 外置可行且改动小（DocTableView 的
// dom append 到 pm-host，用 absolute 对齐 —— 分页测量不受影响？tbody
// 仍在 wrapper 内 —— 分页查 .ProseMirror table 会失败…… 可改为查
// pm-host 下）—— 先验证形态：
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 100)))
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
const clickTd = async () => {
  await p.evaluate(() => { window.__ev = 0; window.addEventListener('pointerdown', () => window.__ev++, { capture: true, passive: true }) })
  const box = await p.evaluate(() => { const td = document.querySelector('.ProseMirror td') || document.querySelector('td'); const r = td.getBoundingClientRect(); return { x: r.x + r.width * 0.7, y: r.y + r.height * 0.5 } })
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(280)
  return (await p.evaluate(() => window.__ev)) > 0
}
console.log('baseline:', await clickTd() ? 'ALIVE' : 'DEAD')
// 形态：wrapper append 到 pm-host（PM 外、React 内）
await p.evaluate(() => {
  const w = document.querySelector('.tableWrapper')
  const pm = window.__pmView.dom
  const host = pm.parentElement // pm-host（React 拥有，PM 不管）
  // absolute 定位对齐原位（相对 pm-host）
  const pr = pm.getBoundingClientRect(), wr = w.getBoundingClientRect()
  host.appendChild(w)
  w.style.position = 'absolute'
  w.style.left = (wr.x - pr.x + pm.scrollLeft) + 'px'
  w.style.top = (wr.y - pr.y + pm.scrollTop) + 'px'
  w.style.zIndex = '5'
  w.style.background = '#fff'
})
await p.waitForTimeout(500)
console.log('wrapper 移到 pm-host(absolute):', await clickTd() ? 'ALIVE ✅✅✅' : 'DEAD')
await b.close()
