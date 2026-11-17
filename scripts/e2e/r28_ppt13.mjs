// DOM 变更只有 4 次 —— 循环是【纯状态级】（setState 但 DOM 输出相同，
// React 只报警不提交 DOM？不对 —— Maximum depth 是提交前检测）。
// 重新想：effect@641 deps [slides, onSlidesChange, slidesToData]
// slidesToData 是 useMemo([deckW, deckH, masterShapes]) —— masterShapes
// 是 useState（稳定）。slides useState（稳定）。onSlidesChange =
// handleSlideSnapshot —— App 每次渲染重建 → 若 App 因 setSlideSnapshot
// 重渲染 → handleSlideSnapshot 新引用 → effect 重跑 → onSlidesChange(
// slidesToData(slides)) —— slidesToData 结果是【新对象】→
// setSlideSnapshot(新对象) → App 重渲染 → 循环！
// DOM 不变（React 跳过相同 DOM 提交）但 setState 循环触发警告。
// ★ 但 MutationObserver 3s 只 4 次 —— 意味着循环已停？警告 34 次是
// 打开瞬间。之后稳定。那画布不渲染是【独立问题】。
// 看实际渲染输出（slide 视图的 DOM 结构到底长啥样）：
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 150)))
p.setDefaultTimeout(30000)
await p.goto(BASE + '/?r=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(2000)
await p.evaluate(async () => {
  const r = await fetch('/upload-test.pptx')
  const buf = await r.arrayBuffer()
  const file = new File([buf], 'test.pptx', { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })
  const dt = new DataTransfer()
  dt.items.add(file)
  document.querySelector('#root > div').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
})
await p.waitForTimeout(6000)
const st = await p.evaluate(() => {
  // 主编辑区结构：找画布（808px 宽的容器）
  const wide = [...document.querySelectorAll('div')].filter(d => {
    const w = d.getBoundingClientRect().width
    return w > 500 && w < 1200 && d.offsetHeight > 300
  }).map(d => ({ w: Math.round(d.getBoundingClientRect().width), h: d.offsetHeight, cls: (d.className || '').toString().slice(0, 40), children: d.children.length, textLen: (d.textContent || '').length }))
  // 缩略图
  const thumbs = [...document.querySelectorAll('img, [class*=thumb]')].slice(0, 5).map(e => e.tagName)
  return { wideDivs: wide.slice(0, 6), thumbs, bodyText: document.body.textContent?.slice(0, 300) }
})
console.log(JSON.stringify(st, null, 1))
await b.close()
