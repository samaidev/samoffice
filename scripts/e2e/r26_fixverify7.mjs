// view.dom reparent 后 doc 仍是 [unsupported]（外置 NodeView 的破坏已发生，
// reparent 救不回 doc）。思路收敛：
// 外置 NodeView 死刑（破坏 doc 同步）。
// ◆◆◆◆◆ 但是！也许有救：外置导致 PM doc 丢表格的原因是 DOMObserver
// 看到 wrapper 被移走。若【外置发生在 PM 读取 DOM 之前】—— 即从
// NodeView constructor 起 wrapper 就从不在 view.dom 内（constructor 里
// 就 append 到 pm-host），PM 的 updateChildren 仍按 NodeView.dom 引用
// 工作而不依赖它在树内 —— 试试 PM 是否容忍：
// （刚才的 relocate 是 rAF 后才移走 —— PM 已经把它插入过。从头就外置试试）
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 100)))
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
// 先建好一个「外部宿主」容器供 NodeView constructor 使用
await p.evaluate(() => {
  window.__extHost = null // 占位
})
// 监听 PM 挂载 —— 不用 __setDocForTest（那是 React 链）。我们 monkey-patch
// DocTableView 不可行（打包内）。改用：正常 setDoc，然后【立即】（同帧）
// 在 PM 插入 NodeView 后但 DOMObserver flush 前移走 —— 时序不可控。
// ◆ 放弃时序赌博。正道：改 tablePlugins.ts 的 relocate 从 rAF 改为
// 「PM 首次把 wrapper append 进 view.dom 的同步瞬间移走」 —— 用
// MutationObserver 监听 view.dom childList，同步 reparent（微任务前）。
// 先在测试里验证「同步移走」是否保住 doc：
await p.evaluate(() => window.__setDocForTest({ meta: { title: 't' }, blocks: [
  { type: 'p', inline: [{ content: '段落内容一' }] },
  { type: 'table', rows: [
    [{ inline: [{ content: 'A1' }] }, { inline: [{ content: 'B1' }] }],
    [{ inline: [{ content: 'A2' }] }, { inline: [{ content: 'B2' }] }],
  ] },
] }))
await p.waitForTimeout(3500)
const docNow = await p.evaluate(() => {
  const a = []
  window.__pmView.state.doc.forEach((n, off) => a.push(off + ':' + n.type.name))
  return a
})
console.log('当前(延迟外置)doc:', JSON.stringify(docNow))
await b.close()
