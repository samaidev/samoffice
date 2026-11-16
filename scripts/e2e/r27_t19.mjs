// 新代码在跑（MessageChannel 已服务）—— proxy 仍死。
// t16 的 MC 层是【evaluate 里建的 MC】。产品代码里【React effect 闭包的
// MC】也死？！那真是「闭包身份」决定了？物理上不可能 —— 
// ★ 除非 effect 压根没跑 onFirst 之后的路径：HMR 热更新后 effect 是
// 【旧实例】（空依赖 []，fast-refresh 不重跑！）。t18 重启 vite 只
// 重置了模块图 —— 但页面是 t13 新开的 goto —— 会拿新代码……
// 除非【浏览器缓存】了旧模块。用硬禁缓存 context 重测：
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const ctx = await b.newContext({ viewport: { width: 1360, height: 900 }, serviceWorkers: 'block' })
await ctx.route('**/*', route => route.continue()) // 不动 —— 直接 no-cache 请求头
const p = await ctx.newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 150)))
p.setDefaultTimeout(30000)
// 禁用 HTTP 缓存
await p.route('**/*', async route => {
  const headers = { ...route.request().headers(), 'cache-control': 'no-cache' }
  await route.continue({ headers })
})
await p.goto(BASE + '/?fresh=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
await p.evaluate(() => window.__setDocForTest({ meta: { title: 't' }, blocks: [
  { type: 'p', inline: [{ content: '段落内容一' }] },
  { type: 'table', rows: [
    [{ inline: [{ content: 'A1' }] }, { inline: [{ content: 'B1' }] }],
    [{ inline: [{ content: 'A2' }] }, { inline: [{ content: 'B2' }] }],
  ] },
] }))
await p.waitForTimeout(2500)
const pb = await p.evaluate(() => { const r = document.querySelector('.ProseMirror p').getBoundingClientRect(); return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.5 } })
await p.mouse.click(pb.x, pb.y)
await p.waitForTimeout(4500)
// 确认新代码生效：proxy 建立时间（400ms channel 后）+ 点击
const st = await p.evaluate(() => {
  const v = window.__pmView
  const orig = v.dispatch.bind(v)
  window.__dispatches = []
  v.dispatch = (tr) => { window.__dispatches.push('SEL:' + (tr.selection ? tr.selection.from : -1)); return orig(tr) }
  return { proxyCount: document.querySelectorAll('.pm-table-clickproxy').length }
})
console.log('proxy:', JSON.stringify(st))
const box = await p.evaluate(() => { const r = document.querySelector('td').getBoundingClientRect(); return { x: r.x + r.width * 0.6, y: r.y + r.height * 0.5 } })
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(900)
console.log('dispatch:', JSON.stringify(await p.evaluate(() => window.__dispatches)))
console.log('from:', await p.evaluate(() => window.__pmView.state.selection.from), '(25=handler跑了)')
await b.close()
