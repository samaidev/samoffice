// ★★★ 发现严重 bug：「Maximum update depth exceeded」无限循环！
// SlideEditor 挂载后 setState 死循环 —— 这可能就是「渲染格式完全不行」
// 的一部分（渲染中断/回退）。定位：截获 React 组件栈 + 检查 slide 视图
// 的实际渲染输出。
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
let loopCount = 0
p.on('console', m => { if (m.text().includes('Maximum update depth')) loopCount++ })
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 200)))
p.setDefaultTimeout(30000)
await p.goto(BASE + '/?r=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(2000)
await p.evaluate(async () => {
  const r = await fetch('/upload-test.pptx')
  const buf = await r.arrayBuffer()
  const file = new File([buf], 'test.pptx', { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })
  const dt = new DataTransfer()
  dt.items.add(file)
  const root = document.querySelector('#root > div')
  root.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
})
await p.waitForTimeout(6000)
console.log('死循环警告次数(6s内):', loopCount)
// slide 视图实际 DOM 结构
const st = await p.evaluate(() => {
  // SlideEditor 的渲染容器特征：找 .slide-canvas / [class*=canvas] / svg 结构
  const svgRoots = [...document.querySelectorAll('svg')].map(s => ({
    cls: s.getAttribute('class')?.slice(0, 30),
    w: s.getAttribute('width'),
    h: s.getAttribute('height'),
    children: s.children.length,
  }))
  // 缩略图栏
  const thumbs = document.querySelectorAll('[class*=thumb],[class*=filmstrip],[class*=film]')
  return {
    svgRoots,
    thumbs: thumbs.length,
    // 主编辑区文本内容量
    mainText: (document.querySelector('main, [class*=editor]')?.textContent || '').length,
  }
})
console.log('SVG 结构:', JSON.stringify(st, null, 1))
await b.close()
