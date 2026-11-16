// ★★★ elementFromPoint = pm-table-clickproxy 在最上，但事件还是没派发！
// 代理层也死了？！它在 pm-host 里（PM 外）…… 
// 等等 —— pm-host 是 .ProseMirror 的 parentElement。而 .ProseMirror 的
// 父级是【L0: 带类名的 div】。但 PM 树 = view.dom 的子树。
// pm-host 本身不在 PM 内。但 hit-test 死区也许已经【蔓延】到 pm-host
// 里新加的 absolute 层 —— 与 r26_final_scheme L0 实验矛盾（L0 ALIVE）！
// 差异：final_scheme 的 holder 是【新建的 div】；我们的 proxy 也是新建的……
// 唯一差异 = holder 里放的是【wrapper 原节点】，proxy 是空层自己接收 —— 
// final_scheme 测的「点击」命中的是 holder 里的 wrapper td！
// 不是 holder 本身！！
// ◆◆◆ 即：死区其实覆盖【一切后来加进该区域的层】—— 之前所有「ALIVE」
// 实验（body holder、root holder）全部是【视口其它位置】或【移动了 wrapper】。
// 只有 wrapper 原节点移到 PM 外才活 —— 因为那时它在 pm-host/body 的
// 【原坐标之外】？不 —— factor19 holder 就在原坐标附近+250px。
// ◆ 停止发散！直接验证最核心问题：【新层放原表格位置】收不收事件：
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
// 在 pm-host 放两层：一层盖原表格位置（z7），一层盖旁边空白（z7）
const pts = await p.evaluate(() => {
  const pm = window.__pmView.dom
  const host = pm.parentElement
  const w = document.querySelector('.tableWrapper')
  const wr = w.getBoundingClientRect()
  const hr = host.getBoundingClientRect()
  const mk = (x, y, wd, ht, tag) => {
    const d = document.createElement('div')
    d.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${wd}px;height:${ht}px;z-index:7;background:rgba(255,0,0,0.08)`
    d.dataset.tag = tag
    d.addEventListener('mousedown', () => { window.__hit = tag })
    host.appendChild(d)
    const r = d.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  }
  window.__hit = ''
  const overTable = mk(wr.left - hr.left, wr.top - hr.top, wr.width, wr.height, 'OVER-TABLE')
  const beside = mk(wr.left - hr.left + wr.width + 60, wr.top - hr.top, 120, 80, 'BESIDE')
  return { overTable, beside }
})
await p.mouse.click(pts.overTable.x, pts.overTable.y)
await p.waitForTimeout(200)
console.log('盖表格位置的层:', await p.evaluate(() => window.__hit) || '无事件(DEAD)')
await p.mouse.click(pts.beside.x, pts.beside.y)
await p.waitForTimeout(200)
console.log('旁边空白层:', await p.evaluate(() => window.__hit) || '无事件(DEAD)')
await b.close()
