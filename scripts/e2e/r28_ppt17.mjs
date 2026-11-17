// ★★★ 破案关键数据：
// - 画布里只有 5 个 shape div（真相第 1 页有：大标题 + 副标题，且真相
//   有灰绿色背景 #8a8b83 —— 背景没渲染！）
// - 文字都在（26/14/12 字符）且可见 —— 但截图全白？!
// - 注意 color: rgb(15,23,42)（深色文字）在白底上应该可见！
// ★ 除非…… clip 截图截错了元素 —— bg-white shadow-xl 匹配了【其他
// 容器】（比如大纲视图/放映预览）！检查该类的元素数量与位置：
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
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
  const cands = [...document.querySelectorAll('div')].filter(d => (d.className || '').toString().includes('bg-white shadow-xl'))
  return cands.map(d => {
    const r = d.getBoundingClientRect()
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), cls: d.className.toString().slice(0, 60) }
  })
})
console.log('bg-white shadow-xl 候选:', JSON.stringify(st, null, 1))
// 找真正的幻灯片画布：含 16 页 shapes 的容器 —— 从缩略图 IMG 反查
const canvasProbe = await p.evaluate(() => {
  // 缩略图 img 的父容器链
  const imgs = [...document.querySelectorAll('img')].filter(i => i.src.startsWith('data:'))
  return imgs.slice(0, 3).map(i => {
    const r = i.getBoundingClientRect()
    return { w: Math.round(r.width), h: Math.round(r.height), visible: r.width > 10 }
  })
})
console.log('数据缩略图:', JSON.stringify(canvasProbe))
await b.close()
