// 死循环定位：用 React DevTools 不可行 —— 直接劫持 console.error 抓
// 组件栈（Maximum update depth 警告带组件栈）：
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('console', m => {
  const t = m.text()
  if (t.includes('Maximum update depth')) {
    // 附带的 stack trace 行
    const lines = t.split('\n').filter(l => /at |in /.test(l)).slice(0, 6)
    console.log('LOOP-STACK:', lines.join(' | ').slice(0, 300))
  }
})
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 100)))
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
await p.waitForTimeout(5000)
console.log('done')
await b.close()
