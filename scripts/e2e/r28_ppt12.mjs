// setMasterShapes 只在 506 行调用（masterView 分支）—— 不是循环源。
// SlideEditor.tsx:381 是 useState 初始化行 —— 帧栈行号指向 SlideEditor
// 渲染本体。循环的 setState 是谁？—— 用 React 探针：劫持
// console.error 前，先 patch React 的 setState 来源：不现实。
// ★ 换路：二分法注释。但先看更简单的可能 —— effect@641
// onSlidesChange(slidesToData(slides)) → App.handleSlideSnapshot →
// setSlideSnapshot → App 重渲染 → SlideEditor props 变化？key 没变、
// initialSlides 没变 —— 但 handleSlideSnapshot 是内联函数？不是，是
// const 定义（每次 App 渲染重建引用）→ effect deps [onSlidesChange]
// 每次都变 → 每次重跑 → onSlidesChange → setSlideSnapshot → App 渲染
// → 新 handleSlideSnapshot 引用 → effect 再跑 → 无限循环！！
// ★★★ 就是这个！onSlidesChange 引用不稳定。
// 验证：App 渲染次数：
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
let renders = 0
p.on('console', m => { if (m.text().includes('R28-RENDER')) renders++ })
p.setDefaultTimeout(30000)
await p.goto(BASE + '/?r=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(2000)
// App 里插桩不可行（没改代码）—— 用间接指标：性能计数
const ok = await p.evaluate(async () => {
  // 抓 React 提交频率：MutationObserver on #root
  window.__muts = 0
  const mo = new MutationObserver(() => window.__muts++)
  mo.observe(document.querySelector('#root'), { childList: true, subtree: true, attributes: true })
  const r = await fetch('/upload-test.pptx')
  const buf = await r.arrayBuffer()
  const file = new File([buf], 'test.pptx', { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })
  const dt = new DataTransfer()
  dt.items.add(file)
  document.querySelector('#root > div').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
  return 'ok'
})
await p.waitForTimeout(3000)
const muts = await p.evaluate(() => window.__muts)
console.log('3 秒内 DOM 变更次数:', muts)
console.log('结论:', muts > 500 ? '确认无限渲染循环' : '可能已稳定')
await b.close()
