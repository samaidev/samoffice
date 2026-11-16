// body 上 PM 运行时 + 表 = ALIVE。React(#root 内) + PM = DEAD。
// 现在把同样的 PM 直挂 #root 里（React 容器内、但非 React 管理的子树 ——
// 用 dangerouslySetInnerHTML 的洞或直接 appendChild 到 #root 末尾）：
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1000)
const res = await p.evaluate(async () => {
  const pv = await import('/node_modules/.vite/deps/prosemirror-view.js?v=5811b916')
  const pm = await import('/node_modules/.vite/deps/prosemirror-model.js?v=5811b916')
  const ps = await import('/node_modules/.vite/deps/prosemirror-state.js?v=5811b916')
  const { EditorState } = ps, { EditorView } = pv, { Schema, DOMParser } = pm
  const schema = new Schema({ nodes: {
    doc: { content: 'paragraph+' },
    paragraph: { content: 'text*', toDOM: () => ['p', 0], parseDOM: [{ tag: 'p' }] },
    text: {},
  } })
  // 挂到 #root（React 容器）
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:200px;top:200px;width:500px;height:300px;z-index:99999;background:#fff;border:2px solid #333;overflow:auto'
  host.innerHTML = '<div class="mini-pm-host"></div>'
  document.getElementById('root').appendChild(host)
  const view = new EditorView(host.querySelector('.mini-pm-host'), {
    state: EditorState.create({ doc: DOMParser.fromSchema(schema).parse(document.createElement('div')) }),
    attributes: { class: 'ProseMirror' },
  })
  const tbl = document.createElement('table')
  tbl.style.cssText = 'border-collapse:collapse;width:300px'
  tbl.innerHTML = '<tr><td style="height:40px;border:1px solid #333"><p><span>IN-ROOT-PM</span></p></td></tr>'
  host.appendChild(tbl)
  window.__ev = 0
  window.addEventListener('pointerdown', () => window.__ev++, { capture: true, passive: true })
  const r = tbl.getBoundingClientRect()
  return { x: r.x + 80, y: r.y + 20 }
})
await p.waitForTimeout(400)
await p.mouse.click(res.x, res.y)
await p.waitForTimeout(250)
console.log('#root 内 PM+表:', (await p.evaluate(() => window.__ev)) > 0 ? 'ALIVE ✅' : 'DEAD')
await b.close()
