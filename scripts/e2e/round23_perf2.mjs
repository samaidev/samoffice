// 优化后完整性能验证（本地）：打字延迟/滚动帧率/长任务
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(25000)
await p.goto('http://localhost:18400', { waitUntil: 'networkidle' })
await p.evaluate(() => localStorage.setItem('samoffice_theme', 'light'))
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(1000)
const buf = fs.readFileSync(DOC)
const form = new FormData()
form.append('file', new Blob([buf]), 'contract.docx')
const r = await fetch('http://localhost:18400/api/doc/open', { method: 'POST', body: form })
const j = await r.json()
await p.evaluate(d => window.__setDocForTest(d), j.document)
// 打开文档 8s 内长任务
await p.evaluate(() => {
  window.__perf = { longTasks: [] }
  new PerformanceObserver(list => { for (const e of list.getEntries()) window.__perf.longTasks.push(Math.round(e.duration)) }).observe({ entryTypes: ['longtask'] })
})
await p.waitForTimeout(8000)
const settle = await p.evaluate(() => ({ n: window.__perf.longTasks.length, worst: Math.max(0, ...window.__perf.longTasks), total: window.__perf.longTasks.reduce((a,b)=>a+b,0) }))
console.log('打开文档 8s 内长任务:', JSON.stringify(settle))
// 打字延迟
const typePerf = await p.evaluate(async () => {
  const pm = window.__pmView
  pm.focus()
  const times = []
  for (let i = 0; i < 10; i++) {
    const t0 = performance.now()
    pm.dispatch(pm.state.tr.insertText('x'))
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    times.push(Math.round(performance.now() - t0))
  }
  for (let i = 0; i < 10; i++) { pm.dispatch(pm.state.tr.delete(1, 2).setMeta('addToHistory', false)); await 0 }
  return { avg: Math.round(times.reduce((a, b) => a + b, 0) / times.length), times }
})
console.log('打字延迟:', JSON.stringify(typePerf))
// 滚动帧率
await p.evaluate(() => {
  window.__perf.frames = 0; window.__perf._t0 = performance.now()
  const cnt = () => { window.__perf.frames++; requestAnimationFrame(cnt) }
  requestAnimationFrame(cnt)
})
await p.mouse.move(700, 400)
for (let i = 0; i < 24; i++) { await p.mouse.wheel(0, 600); await p.waitForTimeout(90) }
await p.waitForTimeout(1500)
const scroll = await p.evaluate(() => { const el = performance.now() - window.__perf._t0; return { fps: Math.round(window.__perf.frames / (el / 1000)), longDuringScroll: window.__perf.longTasks.length - 10 } })
console.log('滚动帧率:', JSON.stringify(scroll))
await b.close()
