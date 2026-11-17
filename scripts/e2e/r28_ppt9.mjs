// onDrop 在根 div 上 —— dispatchEvent 应触发（React 合成事件监听 root）。
// 之前 drop 无效可能是 backend 为 null（openDroppedFiles 首行 if (!backend) return）。
// 检查 backend 初始化：
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('console', m => { const t = m.text(); if (/fail|error|打开|open/i.test(t)) console.log('LOG:', t.slice(0, 100)) })
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 150)))
p.setDefaultTimeout(30000)
await p.goto(BASE + '/?r=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(3000)
// 状态指示（local=绿 remote=蓝 圆点）+ 手动检查 fetch api base
const pre = await p.evaluate(async () => {
  // App 里 getApiBase 的行为 —— 探测 /api/health
  const r = await fetch('/api/health').catch(e => ({ ok: false, status: String(e) }))
  return { health: r.ok ? 'ok' : 'fail:' + r.status }
})
console.log('前置:', JSON.stringify(pre))
const ok = await p.evaluate(async () => {
  const r = await fetch('/upload-test.pptx')
  const buf = await r.arrayBuffer()
  const file = new File([buf], 'test.pptx', { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })
  const dt = new DataTransfer()
  dt.items.add(file)
  const root = document.querySelector('#root > div') || document.querySelector('#root')
  root.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
  return 'dropped-on:' + (root.id || root.className?.toString().slice(0, 20))
})
console.log(ok)
await p.waitForTimeout(10000)
const st = await p.evaluate(() => ({
  tabs: [...document.querySelectorAll('[class*=window],[class*=tab-item],[role=tab]')].filter(e => e.offsetParent !== null).map(e => e.textContent?.slice(0, 26)).slice(0, 8),
  slideEls: document.querySelectorAll('[class*=slide]').length,
  svgs: document.querySelectorAll('svg').length,
  ribbonTabs: [...document.querySelectorAll('button')].filter(x => x.offsetParent !== null).map(x => x.textContent?.trim()).filter(t => t && t.length < 12).slice(0, 14),
}))
console.log('状态:', JSON.stringify(st, null, 1))
await p.screenshot({ path: '/tmp/ppt_sam2.png' })
await b.close()
