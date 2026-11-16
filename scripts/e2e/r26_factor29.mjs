// PM 官方插件全活。那 factor24/28 的「活」共性：**编辑器是重写后新建的**。
// 而应用真实 PM 是 React mount 时建的。差异= StrictMode 双挂载！
// 真实链：mount → view.destroy()（StrictMode 模拟卸载）→ 再 mount。
// destroy 时 PM 从 dom 上 remove 监听…… 但 destroy 后【旧 dom 节点若
// 仍留在编辑器容器里】（React 没清）→ 新 view 用新 dom —— 旧的隐藏在哪？
// 之前查过 .ProseMirror 只有 1 个。但【旧监听器在 document 上的
// selectionchange 被 destroy 移除】（connectSelection disconnect）—— 
// factor25 栈里 EditorView.updateStateInner 也 connectSelection —— 
// 3 个 selectionchange = React 委托1 + PM 1 + DocumentEditor 1 —— 
// 不是双挂载残留（PM 的会被 disconnect）。
// ◆◆◆ 换终极对照：【不重写 DOM】，只把真实 PM 的 dom 换掉 ——
// 用 view.setProps({ state }) 重建？updateStateInner 走过（selectionchange
// 重连）却仍死。真实 PM 与 factor24 PM 的差异还剩：
// 1) 宿主 div 不同 2) dispatchTransaction 定制 3) transformAttrs
// 4) 【NodeView: DocTableView】factor24 的 schema 没有 NodeView！
// ★★★★ DocTableView！真实表格的 wrapper 是 NodeView 创建并 append 的！
// factor24 的 wrapper 是 PM 默认 toDOM 渲染（走 PM 内部 docView 更新）！
// 验证：重写法 + DocTableView NodeView → 死不死：
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
  document.body.innerHTML = document.body.innerHTML
  await new Promise(r => setTimeout(r, 50))
  const pm = await import('/node_modules/.vite/deps/prosemirror-model.js?v=5811b916')
  const ps = await import('/node_modules/.vite/deps/prosemirror-state.js?v=5811b916')
  const pv = await import('/node_modules/.vite/deps/prosemirror-view.js?v=5811b916')
  const { Schema, DOMParser } = pm, { EditorState } = ps, { EditorView } = pv
  const schema = new Schema({
    nodes: {
      doc: { content: 'paragraph table paragraph' },
      paragraph: { content: 'text*', toDOM: () => ['p', 0], parseDOM: [{ tag: 'p' }] },
      table: {
        content: 'table_row+', tableRole: 'table',
        // 模拟 DocTableView 的结构（div.tableWrapper > table > tbody）
        toDOM: () => ['div', { class: 'tableWrapper' }, ['table', { class: 'pm-table' }, ['tbody', 0]]],
        parseDOM: [{ tag: 'div.tableWrapper' }],
      },
      table_row: { content: 'table_cell+', tableRole: 'row', toDOM: () => ['tr', 0], parseDOM: [{ tag: 'tr' }] },
      table_cell: { content: 'paragraph+', tableRole: 'cell', attrs: { colspan: { default: 1 }, rowspan: { default: 1 }, colwidth: { default: null } }, toDOM: () => ['td', 0], parseDOM: [{ tag: 'td' }] },
      text: {},
    },
  })
  const oldPm = document.querySelector('.ProseMirror')
  const host = document.createElement('div')
  oldPm.parentElement.insertBefore(host, oldPm)
  const doc = DOMParser.fromSchema(schema).parse(oldPm)
  oldPm.remove()
  // ★ NodeView：完全复刻 DocTableView 的构造逻辑
  const view = new EditorView(host, {
    state: EditorState.create({ doc }),
    attributes: { class: 'ProseMirror' },
    nodeViews: {
      table(node) {
        const dom = document.createElement('div')
        dom.className = 'tableWrapper'
        const table = document.createElement('table')
        table.className = 'pm-table'
        table.style.borderCollapse = 'collapse'
        dom.appendChild(table)
        const colgroup = document.createElement('colgroup')
        table.appendChild(colgroup)
        const contentDOM = document.createElement('tbody')
        table.appendChild(contentDOM)
        // 手柄（DocTableView.attachHandle 的核心：document mousemove 监听）
        const h = document.createElement('div')
        h.className = 'pm-table-handle'
        h.setAttribute('contenteditable', 'false')
        dom.appendChild(h)
        const onDocMove = () => { /* 模拟 attachHandle 的 document mousemove */ }
        window.document.addEventListener('mousemove', onDocMove)
        return {
          dom, contentDOM, table, colgroup,
          update: () => true,
          destroy: () => window.document.removeEventListener('mousemove', onDocMove),
        }
      },
    },
  })
  window.__ev = 0
  window.addEventListener('pointerdown', () => window.__ev++, { capture: true, passive: true })
  const td = host.querySelector('td')
  const r = td.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width }
})
await p.waitForTimeout(600)
await p.mouse.click(res.x, res.y)
await p.waitForTimeout(250)
console.log('重写+NodeView(复刻 DocTableView):', (await p.evaluate(() => window.__ev)) > 0 ? 'ALIVE ✅ → NodeView 无罪' : 'DEAD → NodeView 有罪')
await b.close()
