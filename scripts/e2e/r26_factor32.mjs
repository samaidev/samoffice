// cell= 空 —— 第二个编辑器根本没渲染表格（setDocForTest 同 path 复用窗口，
// doc2 传了但可能渲染没完成或 path 相同走了更新）。等更久并确认。
// 同时准备 fallback：如果「后建的真实编辑器」也死 —— 所有新建 PM 都活、
// 唯独「React 组件链建的 PM」死 → 差异在 DocumentEditor 的
// useEffect 依赖数组/双 rAF/分页插件挂载时序。
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
console.log('编辑器1:', await p.evaluate(() => document.querySelector('.ProseMirror td')?.textContent))
// 直接 new 一个【完整复刻 + DocumentEditor 环境的 PM】：关键补齐 —— 
// DocumentEditor 的 view 建立在【带 padding 的 pm-host + pageRef + editorScroll】
// 容器里。factor24 建在了 oldPm 原位（同容器）…… 
// ◆ 穷尽 FacTors 后剩一个没测：**应用 PM dom 的父容器是 React 渲染的**
// （editorRef div），factor24 的 host 是 JS 直插。React 渲染的容器带
// React 内部引用。测：重写法建 PM 后，把 host 移入 React 的 pm-host div：
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
      table: { content: 'table_row+', tableRole: 'table', toDOM: () => ['div', { class: 'tableWrapper' }, ['table', { class: 'pm-table' }, ['tbody', 0]]], parseDOM: [{ tag: 'div.tableWrapper' }] },
      table_row: { content: 'table_cell+', tableRole: 'row', toDOM: () => ['tr', 0], parseDOM: [{ tag: 'tr' }] },
      table_cell: { content: 'paragraph+', tableRole: 'cell', attrs: { colspan: { default: 1 }, rowspan: { default: 1 }, colwidth: { default: null } }, toDOM: () => ['td', 0], parseDOM: [{ tag: 'td' }] },
      text: {},
    },
  })
  const oldPm = document.querySelector('.ProseMirror')
  // ★ 放进 React 的 pm-host（编辑器原本的宿主容器，React 拥有）
  const reactHost = oldPm.parentElement
  const doc = DOMParser.fromSchema(schema).parse(oldPm)
  oldPm.remove()
  const view = new EditorView(reactHost, { state: EditorState.create({ doc }), attributes: { class: 'ProseMirror' } })
  window.__ev = 0
  window.addEventListener('pointerdown', () => window.__ev++, { capture: true, passive: true })
  const td = reactHost.querySelector('td')
  const r = td.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
await p.waitForTimeout(600)
await p.mouse.click(res.x, res.y)
await p.waitForTimeout(250)
console.log('重写后 PM 建在 React 的 pm-host 里:', (await p.evaluate(() => window.__ev)) > 0 ? 'ALIVE ✅' : 'DEAD')
await b.close()
