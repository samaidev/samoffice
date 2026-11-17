import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
await p.goto(BASE + '/?r=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(2500)
await p.evaluate(async () => {
  const r = await fetch('/upload-test.pptx')
  const buf = await r.arrayBuffer()
  const file = new File([buf], 'upload-test.pptx', { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })
  const dt = new DataTransfer()
  dt.items.add(file)
  document.querySelector('#root > div').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
})
await p.waitForTimeout(9000)
const dom = await p.evaluate(() => {
  // 找 slide 编辑器特征
  const out = { tests: {} }
  out.hasSlideData = !!window.__slidesData || !!document.querySelector('[class*=slide]')
  // 缩略图列表
  const thumbs = [...document.querySelectorAll('button, [role=button], li, div')].filter(x => x.offsetParent !== null && x.children.length <= 3 && /^5$/.test((x.textContent || '').trim()))
  out.thumb5 = thumbs.length
  // 画布：查 SlideEditor 的渲染容器
  const canvasHost = [...document.querySelectorAll('div')].filter(d => { const r = d.getBoundingClientRect(); return r.width > 600 && r.height > 350 })
  out.bigDivs = canvasHost.length
  // 形状 svg/div 元素（ShapeItem 渲染痕迹）
  out.shapeEls = document.querySelectorAll('[class*=shape], svg [class*=shape]').length
  out.clips = document.querySelectorAll('[style*=clip-path]').length
  // 页面指示
  out.pageInd = (document.body.textContent.match(/(\d+)\s*\/\s*16/) || [])[0]
  return out
})
console.log(JSON.stringify(dom, null, 1))
await p.screenshot({ path: '/tmp/r32_state.png' })
await b.close()
