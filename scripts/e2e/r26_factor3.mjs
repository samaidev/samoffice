// ★ 静态回放 ALIVE！应用 DOM+CSS 无罪 → 差异在【运行时行为】：
// React 挂的 props/监听 或 PM 的 DOM 属性（如 PM 在 dom 上挂的
// contenteditable 白名单、autocorrect 等）或 **React 的合成事件系统**。
// React 18 createRoot 在 #root 上挂 capture+bubble 监听 —— 之前 dump 过：
// pointerdown/mousedown 在 #root。about:blank 无 React。
// 决定性实验 C：静态回放页 + 手动在 #root 模拟 React 监听（仅 addEventListener
// 空处理器，模拟 React 的委托存在）→ 若死 → 「监听器存在本身」触发 Chromium bug？
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const pa = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
await pa.goto(BASE, { waitUntil: 'networkidle' })
await pa.waitForTimeout(1200)
await pa.evaluate(() => window.__setDocForTest({ meta: { title: 't' }, blocks: [
  { type: 'p', inline: [{ text: '段落' }] },
  { type: 'table', rows: [
    [{ inline: [{ text: 'A1' }] }, { inline: [{ text: 'B1' }] }],
    [{ inline: [{ text: 'A2' }] }, { inline: [{ text: 'B2' }] }],
  ] },
] }))
await pa.waitForTimeout(2500)
const extracted = await pa.evaluate(() => {
  const css = [...document.querySelectorAll('style, link[rel=stylesheet]')].map(s => s.outerHTML).join('\n')
  const sc = document.querySelector('.flex-1.overflow-auto')
  return { css, html: sc.outerHTML }
})
// 回放 + #root 挂 React 式监听（capture+passive 与 React 一致性微调）
const mkReplay = async (withReactLike) => {
  const p2 = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
  await p2.goto('about:blank')
  await p2.evaluate(({ css, html, reactLike }) => {
    document.head.innerHTML = css
    document.body.style.cssText = 'margin:0;height:900px;overflow:hidden'
    document.body.innerHTML = `<div id="root"><div class="flex flex-col h-screen" style="height:900px;overflow:hidden"><main class="flex-1 overflow-hidden min-h-0 flex"><div class="flex-1 overflow-hidden min-w-0"><div class="flex flex-col h-full" style="position:relative"><div style="flex:1 1 auto;display:flex;min-height:0;flex-direction:column">${html}</div></div></div></main></div></div>`
    if (reactLike) {
      // React 18 在 root 上挂的监听（非 passive，含 pointer 系列）
      for (const ev of ['pointerdown','pointermove','pointerup','mousedown','mouseup','click','dragstart','drop','dragover','wheel']) {
        document.getElementById('root').addEventListener(ev, () => {}, false)
        document.getElementById('root').addEventListener(ev, () => {}, true)
      }
    }
    window.__e = 0
    window.addEventListener('pointerdown', () => window.__e++, { capture: true, passive: true })
  }, { ...extracted, reactLike: withReactLike })
  await p2.waitForTimeout(600)
  const box = await p2.evaluate(() => { const r = document.querySelector('.ProseMirror td').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
  await p2.mouse.click(box.x, box.y)
  await p2.waitForTimeout(250)
  const alive = (await p2.evaluate(() => window.__e)) > 0
  await p2.close()
  return alive
}
console.log('回放+React式监听:', await mkReplay(true) ? 'ALIVE ✅' : 'DEAD')
console.log('回放(对照):', await mkReplay(false) ? 'ALIVE ✅' : 'DEAD')
await b.close()
