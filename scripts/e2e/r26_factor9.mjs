// 一个页面、无弹窗、无 drag。全部事件零。
// ◆ 终极手段：Chromium 的 event delivery 追踪 —— CDP 
// 'Input.setIgnoreInputEvents' 反向验证不行。
// 用 CDP 'EventBreakpoints' —— 不行。
// ★★★★ 用「Event listener breakpoint」的替代品：在 window 上挂
// 【getter 陷阱】不可能。但 Chromium 有一个我们没测的观察口：
// document.onpointerdown = null 赋值监听（DOM0）→ 也收不到（一样）。
// ◆◆◆ 完全换个方向 —— 从「哪里不同」转向「复现条件可以多简单」：
// about:blank 回放活。现在在回放页里【加入 PM 真身】：
// 从 npm 拿 prosemirror-view 在 about:blank 建 PM 编辑器 + 表格 schema。
// 若死 → 问题 = PM 运行时！若活 → 问题 = React+PM 组合。
// （PM 的 Editable DOM 有 mutation observer + selectionchange 全局监听 ——
//   这些【全局监听器】是 about:blank 回放没有的！）
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
// 从 vite 拿 prosemirror 模块（在应用页 import 后挂 window）
const pa = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
await pa.goto(BASE, { waitUntil: 'networkidle' })
await pa.waitForTimeout(800)
// 用动态 import 拿 prosemirror-view/model/state 并在应用页内建第二个 PM 编辑器
// —— 应用页本身就死区 —— 建在 body 的独立容器（非 #root）里！
const res = await pa.evaluate(async () => {
  const pv = await import('/node_modules/.vite/deps/prosemirror-view.js?v=5811b916').catch(() => null)
  const pm = await import('/node_modules/.vite/deps/prosemirror-model.js?v=5811b916').catch(() => null)
  const ps = await import('/node_modules/.vite/deps/prosemirror-state.js?v=5811b916').catch(() => null)
  if (!pv || !pm || !ps) return { err: 'import fail' }
  // 最小 schema：doc > paragraph > text；table 由 HTML 直接嵌入（用 nodeview 不必要）
  const { EditorState } = ps
  const { EditorView } = pv
  const { Schema, DOMParser } = pm
  const schema = new Schema({
    nodes: {
      doc: { content: 'paragraph+' },
      paragraph: { content: 'text*', toDOM: () => ['p', 0], parseDOM: [{ tag: 'p' }] },
      text: {},
    },
  })
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:200px;top:200px;width:500px;height:300px;z-index:99999;background:#fff;border:2px solid #333;overflow:auto'
  // 内部静态表（普通 HTML，非 PM 节点 —— PM dom 是 contenteditable，但表格是 contenteditable=false 的原子？不行，直接放）
  host.innerHTML = '<div class="mini-pm-host"></div>'
  document.body.appendChild(host)
  const view = new EditorView(host.querySelector('.mini-pm-host'), {
    state: EditorState.create({ doc: DOMParser.fromSchema(schema).parse(document.createElement('div')) }),
    attributes: { class: 'ProseMirror' },
  })
  // 在 PM 编辑器 dom 里塞一张原生表（PM doc 空表 —— 手动 append，PM observer 会移除；
  // 为避免移除，把表放到 PM dom 之外、host 之内 —— PM 的事件仍监听 dom 内。）
  // 直接把表 append 到 host（PM 编辑器同级）：
  const tbl = document.createElement('table')
  tbl.style.cssText = 'border-collapse:collapse;width:300px'
  tbl.innerHTML = '<tr><td style="height:40px;border:1px solid #333"><p><span>PM-SIDE</span></p></td></tr>'
  host.appendChild(tbl)
  window.__ev = 0
  window.addEventListener('pointerdown', () => window.__ev++, { capture: true, passive: true })
  const r = tbl.getBoundingClientRect()
  return { x: r.x + 80, y: r.y + 20 }
})
if (res.err) { console.log('import fail:', res.err); await b.close(); process.exit(0) }
await pa.waitForTimeout(400)
await pa.mouse.click(res.x, res.y)
await pa.waitForTimeout(250)
console.log('body 直挂的 PM+表:', (await pa.evaluate(() => window.__ev)) > 0 ? 'ALIVE ✅' : 'DEAD')
await b.close()
