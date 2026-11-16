// ★★★★★ DOM 重写（同 HTML、监听器全丢）→ ALIVE！
// 确认：死因 = 某个 JS 监听器/观察者的存在本身。
// 3 个 selectionchange（PM + spellPlugin? + ?）+ document mousemove。
// 逐个定位：无法 removeEventListener（匿名）—— 但可以【劫持后禁用】：
// 重写 EventTarget.prototype 上特定事件？不行（已注册）。
// ★ 用 CDP DOMDebugger.setEventListenerBreakpoint 逐事件 pause+resume 计数：
// 不直接。换「半重写」法：重写后逐个恢复监听来源不可能。
// ◆ 二分法变体：【重写 DOM】是活的 —— 在重写后的页面里【重建 PM】
//（React 全废了，但我们可以手动 new EditorView + import schema）→ 若死
// → 锁定 PM 挂的 selectionchange/mousemove 组合；若活 → React 侧监听。
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
await p.evaluate(() => window.__setDocForTest({ meta: { title: 't' }, blocks: [
  { type: 'p', inline: [{ text: '段落' }] },
  { type: 'table', rows: [[{ inline: [{ text: 'A1' }] }, { inline: [{ text: 'B1' }] }]] },
] }))
await p.waitForTimeout(2500)
const res = await p.evaluate(async () => {
  // 重写 DOM（清监听）—— React/PM 全部失能，DOM 保留
  const html = document.body.innerHTML
  document.body.innerHTML = html
  await new Promise(r => setTimeout(r, 100))
  // 手动建一个新 PM（拿应用的真实 schema）
  const pm = await import('/node_modules/.vite/deps/prosemirror-model.js?v=5811b916')
  const ps = await import('/node_modules/.vite/deps/prosemirror-state.js?v=5811b916')
  const pv = await import('/node_modules/.vite/deps/prosemirror-view.js?v=5811b916')
  const { Schema, DOMParser } = pm, { EditorState } = ps, { EditorView } = pv
  const schema = new Schema({
    nodes: {
      doc: { content: 'paragraph table paragraph' },
      paragraph: { content: 'text*', toDOM: () => ['p', 0], parseDOM: [{ tag: 'p' }] },
      table: { content: 'table_row+', tableRole: 'table', toDOM: () => ['div', { class: 'tableWrapper' }, ['table', { class: 'pm-table' }, ['tbody', 0]]], parseDOM: [{ tag: 'div.tableWrapper' }] },
      table_row: { content: 'table_cell+', tableRole: 'row', toDOM: () => ['tr', 0], parseDOM: [{ tag: 'tr' }] },
      table_cell: { content: 'paragraph+', tableRole: 'cell', attrs: { colspan: { default: 1 }, rowspan: { default: 1 }, colwidth: { default: null } }, toDOM: () => ['td', 0], parseDOM: [{ tag: 'td' }] },
      text: {},
    },
  })
  // 复用重写后的 .ProseMirror 容器作为 host（里面静态表当内容源）
  const oldPm = document.querySelector('.ProseMirror')
  const host = document.createElement('div')
  oldPm.parentElement.insertBefore(host, oldPm)
  const doc = DOMParser.fromSchema(schema).parse(oldPm)
  oldPm.remove()
  const view = new EditorView(host, { state: EditorState.create({ doc }), attributes: { class: 'ProseMirror' } })
  window.__ev = 0
  window.addEventListener('pointerdown', () => window.__ev++, { capture: true, passive: true })
  const td = host.querySelector('td')
  const r = td.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, rows: view.state.doc.childCount }
})
await p.waitForTimeout(600)
await p.mouse.click(res.x, res.y)
await p.waitForTimeout(250)
console.log('重写后+新 PM(含表):', (await p.evaluate(() => window.__ev)) > 0 ? 'ALIVE ✅ → React 侧问题' : 'DEAD → PM 运行时问题')
await b.close()
