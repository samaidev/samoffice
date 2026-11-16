// ★★★★★ L0（pm-host 内 absolute holder，wrapper 在内）ALIVE（内容有效）！
// 之前 factor12 数据被空内容污染 —— 现在真相大白：
// 「wrapper 在【新创建的 absolute 容器】里（哪怕该容器在 pm-host 内）= 活」
// 而「wrapper 直接是 PM 子节点 = 死」。
// 结合外置教训（不能离开 PM 树，否则 doc 破坏）——
// ◆◆◆ 折中方案：**wrapper 保持在 PM 内（NodeView 正常），但
// pm-host 常驻一个 absolute「表格覆盖层」，wrapper 的【表亲克隆】显示
// 在覆盖层，点击命中克隆 → 把事件转发给真实 wrapper 下的 td（用
// elementFromPoint 不可靠 —— 直接映射坐标 → 真表格的同位置 td →
// 手动构造 selection）**。视觉上克隆盖在原表格上（原表格被遮住）。
// 复杂度高且双渲染。不可取。
// ★★★ 更优：既然「新 absolute 容器」能激活 —— **给 wrapper 本身加
// position:absolute（NodeView 内联样式）+ 用 PM 兼容方式补偿布局** —— 
// wrapper absolute 后脱离流 → 后续段落上移 —— PM 布局坏。
// 但表格后的段落位置本来也受 wrapper 影响 —— absolute 会让 doc 视觉错位。
// ◆ 除非 wrapper 的占位由【分页引擎 margin-bottom 补高】机制承担 —— 
// 太脆弱。
// ★★★★ 终极可行（今天必须收尾）：**克隆层方案**：
// DocTableView 创建后，在 pm-host 放一个【透明事件代理层】盖在表格
// 区域（只拦截事件、零视觉），把 pointer 事件坐标换算成真表格 td 的
// 位置并手动 setSelection + focus。真表格照常渲染（视觉不变），
// 代理层只负责「收点击」。层在 PM 外 → 事件正常派发！
// 验证可行性：代理层收点击 + 手动 setSelection + 打字进格：
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
await p.waitForTimeout(3000)
// 代理层原型
await p.evaluate(() => {
  const w = document.querySelector('.tableWrapper')
  const host = window.__pmView.dom.parentElement
  const proxy = document.createElement('div')
  proxy.setAttribute('data-proxy', '1')
  const r = w.getBoundingClientRect()
  const hr = host.getBoundingClientRect()
  proxy.style.cssText = `position:absolute;left:${r.x - hr.x}px;top:${r.y - hr.y}px;width:${r.width}px;height:${r.height}px;z-index:6;cursor:text`
  host.appendChild(proxy)
  proxy.addEventListener('mousedown', (e) => {
    e.preventDefault()
    // 点击坐标 → wrapper 内 td
    const wr = w.getBoundingClientRect()
    const lx = e.clientX - wr.left, ly = e.clientY - wr.top
    const tds = [...w.querySelectorAll('td')]
    let hit = tds.find(td => {
      const tr = td.getBoundingClientRect()
      return e.clientX >= tr.left && e.clientX <= tr.right && e.clientY >= tr.top && e.clientY <= tr.bottom
    })
    if (!hit) return
    // DOM 顺序 → PM pos（cell 末尾）
    const tr = hit.parentElement
    const rowIdx = [...tr.parentElement.children].indexOf(tr)
    const cellIdx = [...tr.children].indexOf(hit)
    const v = window.__pmView
    let tablePos = -1
    v.state.doc.forEach((n, off) => { if (tablePos < 0 && n.type.name === 'table') tablePos = off })
    if (tablePos < 0) return
    const table = v.state.doc.nodeAt(tablePos)
    const rows = []
    table.forEach((rw, off) => rows.push({ rw, off }))
    if (rowIdx >= rows.length) return
    const rowStart = tablePos + 1 + rows[rowIdx].off
    const cells = []
    rows[rowIdx].rw.forEach((c, off) => cells.push({ c, off }))
    if (cellIdx >= cells.length) return
    const cellStart = rowStart + 1 + cells[cellIdx].off
    const target = cellStart + cells[cellIdx].c.content.size
    v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.near(v.state.doc.resolve(target))))
    v.focus()
  })
})
const box = await p.evaluate(() => { const td = document.querySelector('td'); const r = td.getBoundingClientRect(); return { x: r.x + r.width * 0.7, y: r.y + r.height * 0.5 } })
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(350)
console.log('代理层点击后:', JSON.stringify(await p.evaluate(() => ({ from: window.__pmView.state.selection.from, focus: window.__pmView.hasFocus() }))))
await p.keyboard.type('Q5', { delay: 60 })
await p.waitForTimeout(400)
console.log('td[0]:', JSON.stringify(await p.evaluate(() => document.querySelector('td')?.textContent)))
// doc 完整性
console.log('doc:', JSON.stringify(await p.evaluate(() => { const a = []; window.__pmView.state.doc.forEach((n, off) => a.push(n.type.name)); return a })))
await b.close()
