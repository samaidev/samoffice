// 远程模式：用 drag-drop 打开 pptx（openDroppedFiles → openResult → SlideEditor）
import { chromium } from 'playwright'
import fs from 'fs'
const FILE = '/home/z/my-project/upload/装备工业的互联网 机遇.pptx'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 200)))
p.setDefaultTimeout(30000)
await p.goto(BASE + '/?r=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(2000)
// Playwright 拖拽真文件：用 DataTransfer 造 drop 事件
await p.evaluate(() => {
  window.__dropReady = new Promise(resolve => {
    window.addEventListener('drop', (e) => {
      e.preventDefault()
      resolve(true)
    }, { once: true })
  })
})
const dropped = await p.evaluate(async ({ path }) => {
  // node 侧读不了文件——由 playwright 注入：用 CDP 或者构造 File
  // 简单方案：fetch 后端落盘文件？不行。直接让 evaluate 接收 base64
  return null
}, { path: FILE })
// 用 CDP Input.dispatchDragEvent 不可靠 —— 改为 DataTransfer + dispatchEvent（evaluate 内构造 File 需要字节，通过 fetch 本地 vite 静态不可行）
// ★ 最直接：把文件放到 vite 可访问目录，evaluate 里 fetch 下载字节 → File → DataTransfer → dispatchEvent drop
const ok = await p.evaluate(async () => {
  const r = await fetch('/upload-test.pptx')
  if (!r.ok) return 'fetch-fail:' + r.status
  const buf = await r.arrayBuffer()
  const file = new File([buf], 'test.pptx', { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })
  const dt = new DataTransfer()
  dt.items.add(file)
  const ev = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })
  document.querySelector('#root')?.dispatchEvent(ev) || window.dispatchEvent(ev)
  return 'dropped'
})
console.log('drop:', ok)
await p.waitForTimeout(8000)
const st = await p.evaluate(() => ({
  slideEls: document.querySelectorAll('[class*=slide]').length,
  canvases: document.querySelectorAll('canvas').length,
  svgs: document.querySelectorAll('svg').length,
  imgs: document.querySelectorAll('img').length,
  winTabs: [...document.querySelectorAll('[class*=tab]')].length,
}))
console.log('渲染状态:', JSON.stringify(st))
await p.screenshot({ path: '/tmp/ppt_sam1.png' })
console.log('截图 OK')
await b.close()
