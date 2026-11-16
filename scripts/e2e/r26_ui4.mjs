// ★ evaluate 建的层全活（交互后任意时刻）—— 但 DocTableView 的
// setTimeout 建的层死。执行上下文差异的最后一层窗户纸：
// DocTableView 的 setTimeout 回调跑在【React/PM 的模块闭包】里 —— 
// 不可能影响 DOM 层性质。
// ◆◆◆ 除非 —— HMR 下 DocumentEditor 引用的是【旧模块的 DocTableView】
//（React fast-refresh 不重载非组件 export 的 class —— 引用保持旧版）！
// 旧版 attachClickProxy = transparent + rAF/早期 setTimeout 形态！
// fv9 看到的 bg=rgba(0,0,0,0.004) 是 computed 的 0.003 —— 新代码 —— 
// 但「创建时机」是旧代码的 4000ms？不对 —— fv20 等 5.5s 后 proxy 存在
// —— 旧代码 rAF 时代 proxy 应该在 1s 内就有。
// ★ 直接验证：页面里 DocTableView 的 proxy 是否由「首次交互」触发创建
//（新代码行为：点正文前无 proxy）：
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 100)))
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
await p.evaluate(() => window.__setDocForTest({ meta: { title: 't' }, blocks: [
  { type: 'p', inline: [{ content: '段落内容一' }] },
  { type: 'table', rows: [
    [{ inline: [{ content: 'A1' }] }, { inline: [{ content: 'B1' }] }],
    [{ inline: [{ content: 'A2' }] }, { inline: [{ content: 'B2' }] }],
  ] },
] }))
await p.waitForTimeout(2500)
const before = await p.evaluate(() => document.querySelectorAll('.pm-table-clickproxy').length)
console.log('交互前 proxy 数（应为 0=新代码）:', before)
await b.close()
