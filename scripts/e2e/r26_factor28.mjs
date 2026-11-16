// display 切换也死。重写 body 才活 —— 重写会【替换所有节点】。
// PM 会把 wrapper 移回（DOMObserver）—— 重写后 PM 已废（React 没了），
// wrapper 留在新位置。重写后点击的是【新节点】。
// → 结论其实一直指向：**只要节点是「应用运行时 PM 创建的那批」就死**。
// factor19 转移到 body 的原 wrapper ALIVE —— 反例！（原节点移出活）
// ◆◆ 综合所有：死区 = 「wrapper 在 .ProseMirror 内」+「在应用 React 页面」。
//   factor24 重写后建的新 PM 里 wrapper ALIVE —— 新 PM 不在 .ProseMirror？
//   —— attributes: { class: 'ProseMirror' } —— 在！但活！
//   factor24 与真实应用 PM 的差异：真实 PM 的 schema 有大量插件（表格插件链）。
//   ★★★ 嫌疑归到【某个 PM 插件】！prosemirror-tables 的 TableEditing/
//   cellSelection —— 它们有 mousedown 处理！但事件没到 window……
//   PM 插件的 handleDOMEvents 在 PM 内部 —— 不吞浏览器事件。
// ◆ 最后一击：二分【插件链】。重写法 + 只挂部分插件建 PM。但插件在
//   DocumentEditor 里组装。快速法：直接试「无插件 PM + 表」（factor24 已活）
//   vs 「+ tableEditing 插件」vs「+ 我们的 tablePlugins」：
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
const buildWith = async (plugins) => {
  const res = await p.evaluate(async (pluginNames) => {
    // 重写 DOM（拿静态树 + 全废旧监听）
    document.body.innerHTML = document.body.innerHTML
    await new Promise(r => setTimeout(r, 50))
    const pm = await import('/node_modules/.vite/deps/prosemirror-model.js?v=5811b916')
    const ps = await import('/node_modules/.vite/deps/prosemirror-state.js?v=5811b916')
    const pv = await import('/node_modules/.vite/deps/prosemirror-view.js?v=5811b916')
    const pt = await import('/node_modules/.vite/deps/prosemirror-tables.js?v=5811b916').catch(() => null)
    const { Schema, DOMParser } = pm, { EditorState, Plugin } = ps, { EditorView } = pv
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
    const host = document.createElement('div')
    oldPm.parentElement.insertBefore(host, oldPm)
    const doc = DOMParser.fromSchema(schema).parse(oldPm)
    oldPm.remove()
    const pluginsArr = []
    if (pluginNames.includes('tableEditing') && pt) pluginsArr.push(pt.tableEditing())
    if (pluginNames.includes('columnResizing') && pt) pluginsArr.push(pt.columnResizing({}))
    const view = new EditorView(host, { state: EditorState.create({ doc, plugins: pluginsArr }), attributes: { class: 'ProseMirror' } })
    window.__ev = 0
    window.addEventListener('pointerdown', () => window.__ev++, { capture: true, passive: true })
    const td = host.querySelector('td')
    const r = td.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  }, plugins)
  await p.waitForTimeout(600)
  await p.mouse.click(res.x, res.y)
  await p.waitForTimeout(250)
  return (await p.evaluate(() => window.__ev)) > 0
}
console.log('无插件:', await buildWith([]) ? 'ALIVE' : 'DEAD')
console.log('+ tableEditing:', await buildWith(['tableEditing']) ? 'ALIVE' : 'DEAD')
console.log('+ columnResizing:', await buildWith(['columnResizing']) ? 'ALIVE' : 'DEAD')
console.log('+ 两个:', await buildWith(['tableEditing', 'columnResizing']) ? 'ALIVE' : 'DEAD')
await b.close()
