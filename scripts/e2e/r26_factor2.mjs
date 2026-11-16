// 决定性实验：about:blank 干净页，逐块把应用的东西搬进来：
// A) 纯结构（pm 表格 + 容器层） → 之前 ALIVE
// B) A + 应用的 <style> 全部规则 → ?
// C) B + React 渲染（无） 
// 关键新想法：B 若 ALIVE，差异必在【DOM 的属性/内联样式细节】。
// 提取应用里【真实渲染后的完整 HTML 片段】（editorScroll 到 pageRef 整棵
// outerHTML，含所有内联样式），原样放进 about:blank：
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
// 1) 从应用页拿样式 + 真实 HTML
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
  // 从 editorScroll（含）开始整棵拷贝
  const sc = document.querySelector('.flex-1.overflow-auto')
  return { css, html: sc.outerHTML }
})
console.log('extracted html bytes:', extracted.html.length)
// 2) about:blank 原样复现
const p2 = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
await p2.goto('about:blank')
await p2.evaluate(({ css, html }) => {
  document.head.innerHTML = css
  document.body.style.cssText = 'margin:0;height:900px;overflow:hidden'
  document.body.innerHTML = `<div class="flex flex-col h-screen" style="height:900px;overflow:hidden"><main class="flex-1 overflow-hidden min-h-0 flex"><div class="flex-1 overflow-hidden min-w-0"><div class="flex flex-col h-full" style="position:relative"><div style="flex:1 1 auto;display:flex;min-height:0;flex-direction:column">${html}</div></div></div></main></div>`
}, extracted)
await p2.waitForTimeout(800)
await p2.evaluate(() => { window.__e = 0; window.addEventListener('pointerdown', () => window.__e++, { capture: true, passive: true }) })
const box = await p2.evaluate(() => {
  const td = document.querySelector('.ProseMirror td')
  if (!td) return null
  const r = td.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, vis: r.y > 0 && r.y < 880 }
})
if (!box) { console.log('no td in replay'); await b.close(); process.exit(0) }
await p2.mouse.click(box.x, box.y)
await p2.waitForTimeout(250)
console.log('静态回放(应用DOM+CSS原样):', (await p2.evaluate(() => window.__e)) > 0 ? 'ALIVE ✅' : 'DEAD')
await b.close()
