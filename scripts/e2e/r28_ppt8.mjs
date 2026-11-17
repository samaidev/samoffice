// 截图中央 50% 白 —— drop 可能没走 openDroppedFiles（React onDrop 在特定容器上）
// 检查窗口状态与当前 Tab：
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('console', m => { const t = m.text(); if (t.includes('打开') || t.includes('open') || t.includes('失败')) console.log('LOG:', t.slice(0, 100)) })
p.setDefaultTimeout(30000)
await p.goto(BASE + '/?r=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(2000)
const ok = await p.evaluate(async () => {
  const r = await fetch('/upload-test.pptx')
  const buf = await r.arrayBuffer()
  const file = new File([buf], 'test.pptx', { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })
  const dt = new DataTransfer()
  dt.items.add(file)
  // 找 onDrop 容器：App 的 drop handler 挂在哪（#root / body / 编辑器容器）
  const targets = ['#root', 'body']
  for (const sel of targets) {
    const el = document.querySelector(sel)
    if (el) { el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })); break }
  }
  return 'dropped'
})
console.log(ok)
await p.waitForTimeout(9000)
const st = await p.evaluate(() => ({
  // 活动窗口标题/Tab
  tabs: [...document.querySelectorAll('[class*=window],[class*=tab]')].filter(e => e.offsetParent !== null).map(e => e.textContent?.slice(0, 24)).slice(0, 6),
  toast: [...document.querySelectorAll('[class*=toast],[class*=Toast]')].map(e => e.textContent?.slice(0, 40)),
  slideEls: document.querySelectorAll('[class*=slide]').length,
  ribbonTabs: [...document.querySelectorAll('button')].filter(x => x.offsetParent !== null).map(x => x.textContent?.trim()).filter(t => t && t.length < 10).slice(0, 12),
}))
console.log('状态:', JSON.stringify(st, null, 1))
await b.close()
