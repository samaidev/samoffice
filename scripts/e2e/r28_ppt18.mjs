// 画布唯一（360,219 808x606）且 shapes 可见 —— 但截图全白。
// ★ 怀疑点：Playwright clip 截图时 animate-fade-in 还在 opacity 0？
//（6 秒该结束了）—— 或者 shapes 的 z-index/背景层遮挡？
// 直接在页面里把画布区域转成 dataURL（html2canvas 不可用 —— 用
// drawImage 不行）—— 最简单：全屏截图后按 clip 裁剪（绕过 clip 参数 bug）：
import { chromium } from 'playwright'
import fs from 'fs'
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
await p.waitForTimeout(8000)
await p.screenshot({ path: '/tmp/ppt_full.png', fullPage: false })
console.log('全屏截图 OK')
await b.close()
